/**
 * Gateway webhooks: POST /api/webhooks/stripe and /api/webhooks/razorpay.
 *
 *   1. verify the signature over the raw bytes (gateway.parseWebhook). Anything that does
 *      not verify is a 400 and leaves no trace beyond a log line;
 *   2. store the event once: INSERT payment_events ... ON CONFLICT (gateway, event_id) DO
 *      NOTHING. Nothing inserted means a redelivery: 200 without processing it again;
 *   3. process it. Business rules saying no (an unknown order, an amount mismatch, a
 *      late failure after payment) are an outcome recorded on the event and still a 200,
 *      so the gateway stops retrying. Only an unexpected error (the database is down)
 *      answers 500; the stored event is removed first so the retry is processed.
 *
 * The order is found by the gateway's reference (orders.gateway_ref, unique per
 * gateway), never by anything a browser could send; the amount is checked by
 * fulfilment, never trusted.
 */
import { HttpError } from "../../core/errors";
import { captureError, logger } from "../../core/logger";
import { newId } from "../../core/ids";
import { orderRepo, type OrderRow } from "../../repositories/order.repository";
import { onRefundEvent } from "../refund.service";
import { onCanceled, onPaymentFailed, onRenewed, onSubscriptionUpdated } from "../subscription.service";
import { closeOrder, fulfilOrder } from "./fulfilment.service";
import { WebhookSignatureError, type NormalizedEvent, type PaidGateway } from "./gateway";
import { gatewayOf } from "./gateways";
import { redactedJson } from "./redact";

export interface WebhookResult {
  status: 200 | 400 | 500;
  body: { received: boolean; duplicate?: boolean; outcome?: string; error?: string };
}

/** The order an event is about: by gateway reference, or (before we stored that reference) by our id in its metadata. */
async function orderFor(e: NormalizedEvent): Promise<OrderRow | undefined> {
  if (e.orderRef) {
    const byRef = await orderRepo.byGatewayRef(e.gateway, e.orderRef);
    if (byRef) return byRef;
  }
  if (e.localOrderId && e.orderRef) {
    const byId = await orderRepo.byId(e.localOrderId).catch(() => undefined);
    if (byId && byId.gateway === e.gateway && byId.gateway_ref === null && (await orderRepo.setGatewayRef(byId.id, e.orderRef))) return { ...byId, gateway_ref: e.orderRef };
  }
  return undefined;
}

/** Act on one verified, first-seen event. Returns the outcome and what it touched. */
export async function processEvent(e: NormalizedEvent): Promise<{ outcome: string; orderId: string | null; subscriptionId: string | null }> {
  switch (e.type) {
    case "PAYMENT_SUCCEEDED": {
      const order = await orderFor(e);
      if (!order) return { outcome: "ORDER_NOT_FOUND", orderId: null, subscriptionId: null };
      let subscription = null;
      if (order.kind === "SUBSCRIPTION" && e.subscriptionRef) subscription = await gatewayOf(e.gateway).fetchSubscription(e.subscriptionRef).catch(() => null);
      const r = await fulfilOrder(order.id, { amountMinor: e.amountMinor ?? -1, currency: e.currency ?? "", paymentRef: e.paymentRef, subscriptionRef: e.subscriptionRef, subscription }, "webhook");
      return { outcome: r.outcome, orderId: order.id, subscriptionId: null };
    }
    case "PAYMENT_FAILED": {
      const order = await orderFor(e);
      if (!order) return { outcome: "ORDER_NOT_FOUND", orderId: null, subscriptionId: null };
      if (order.status !== "PENDING") return { outcome: `IGNORED_${order.status}`, orderId: order.id, subscriptionId: null };
      const to = e.failureReason === "CHECKOUT_EXPIRED" ? "EXPIRED" : "FAILED";
      const moved = await closeOrder(order.id, to, e.failureReason);
      return { outcome: moved ? to : "IGNORED", orderId: order.id, subscriptionId: null };
    }
    case "REFUND_SUCCEEDED":
    case "REFUND_FAILED": {
      const r = await onRefundEvent(e.refundRefs, e.localRefundId, e.type === "REFUND_SUCCEEDED" ? "SUCCEEDED" : "FAILED", e.failureReason);
      return { ...r, subscriptionId: null };
    }
    case "SUBSCRIPTION_UPDATED":
      return { ...(await onSubscriptionUpdated(e)), orderId: null };
    case "SUBSCRIPTION_RENEWED":
      return await onRenewed(e);
    case "SUBSCRIPTION_PAYMENT_FAILED":
      return { ...(await onPaymentFailed(e)), orderId: null };
    case "SUBSCRIPTION_CANCELED":
      return { ...(await onCanceled(e)), orderId: null };
    default:
      return { outcome: "IGNORED", orderId: null, subscriptionId: null };
  }
}

export async function handleWebhook(gateway: PaidGateway, rawBody: unknown, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult> {
  if (!Buffer.isBuffer(rawBody)) return { status: 400, body: { received: false, error: "Expected a raw body" } };
  let event: NormalizedEvent;
  try {
    event = gatewayOf(gateway).parseWebhook(rawBody, headers);
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      logger.warn({ gateway, reason: err.message }, "webhook rejected");
      return { status: 400, body: { received: false, error: "Invalid signature" } };
    }
    throw err;
  }

  const rowId = await orderRepo.insertEvent({ id: newId(), gateway, eventId: event.id, type: event.rawType.slice(0, 100) || "unknown", payload: redactedJson(event.payload) });
  if (!rowId) return { status: 200, body: { received: true, duplicate: true } };

  try {
    const r = await processEvent(event);
    await orderRepo.finishEvent(rowId, { outcome: r.outcome, orderId: r.orderId, subscriptionId: r.subscriptionId });
    return { status: 200, body: { received: true, outcome: r.outcome } };
  } catch (err) {
    // A business rule saying no (a 4xx from a service) is an outcome, not a reason to retry.
    if (err instanceof HttpError && err.status < 500) {
      await orderRepo.finishEvent(rowId, { outcome: `REJECTED_${err.code}`, orderId: null, subscriptionId: null });
      return { status: 200, body: { received: true, outcome: `REJECTED_${err.code}` } };
    }
    captureError(err, { where: "webhook", gateway, eventId: event.id, type: event.rawType });
    // Forget the event so the gateway's retry is processed instead of being taken for a duplicate.
    await orderRepo.deleteEvent(rowId).catch(() => undefined);
    return { status: 500, body: { received: false, error: "Processing failed; retry later" } };
  }
}
