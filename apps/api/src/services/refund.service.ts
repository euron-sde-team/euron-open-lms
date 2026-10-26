/**
 * Refunds, requested by ADMIN or FINANCE (domain/admin-permissions.ts canRefund) and
 * settled by the gateway.
 *
 *   request  lock the order; amount <= total - refunded - still-pending refunds, or 409
 *            REFUND_EXCEEDS (the lock makes two concurrent requests see each other);
 *            insert PENDING and audit refund.request; commit; then ask the gateway.
 *   settle   on the gateway's yes (synchronous, or the REFUND_SUCCEEDED webhook,
 *            whichever comes first; the other is a no-op): refunded_minor += amount, the
 *            order moves to PARTIALLY_REFUNDED or REFUNDED (statusAfterRefund), a credit
 *            note is issued, the order's enrollments are revoked when asked to (the
 *            entitlements then say REFUNDED once the order is fully refunded), the buyer
 *            is notified, and refund.settle is audited. A no marks the refund FAILED.
 */
import type { Actor } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { captureError } from "../core/logger";
import { canRefund } from "../domain/admin-permissions";
import { statusAfterRefund } from "../domain/orders";
import { orderRepo } from "../repositories/order.repository";
import { refundRepo } from "../repositories/refund.repository";
import { subscriptionRepo } from "../repositories/subscription.repository";
import { audit } from "./audit.service";
import { revokeEnrollment } from "./enrollment.service";
import { issueCreditNote } from "./invoice.service";
import { notify } from "./notification.service";
import { GatewayError } from "./payments/gateway";
import { gatewayOf } from "./payments/gateways";

export interface RefundInput {
  amountMinor: number;
  reason: string;
  revokeAccess: boolean;
}

export async function requestRefund(actor: Actor, orderId: string, input: RefundInput, ip: string | null): Promise<{ refundId: string }> {
  if (!canRefund(actor.role)) throw forbidden("Only finance staff and admins can refund", "REFUND_FORBIDDEN");
  const { refund, order } = await withTransaction(async (trx) => {
    const order = await orderRepo.lock(orderId, trx);
    if (!order) throw notFound("Order not found");
    if (order.status !== "PAID" && order.status !== "PARTIALLY_REFUNDED") throw conflict("Only paid orders can be refunded", "NOT_REFUNDABLE");
    if (order.gateway === "FREE" || !order.gateway_payment_ref) throw conflict("This order took no payment to refund", "NOT_REFUNDABLE");
    const pending = await refundRepo.pendingTotal(order.id, trx);
    const left = order.total_minor - order.refunded_minor - pending;
    if (input.amountMinor > left) throw conflict("That is more than is left to refund on this order", "REFUND_EXCEEDS", { refundableMinor: Math.max(0, left) });
    const id = newId();
    await refundRepo.insert({ id, order_id: order.id, amount_minor: input.amountMinor, reason: input.reason, revoke_access: input.revokeAccess, requested_by: actor.id }, trx);
    await audit({ actorId: actor.id, action: "refund.request", entityType: "order", entityId: order.id, ip, data: { refundId: id, amountMinor: input.amountMinor, currency: order.currency, reason: input.reason, revokeAccess: input.revokeAccess } }, trx);
    return { refund: { id }, order };
  });

  let result;
  try {
    result = await gatewayOf(order.gateway as "STRIPE" | "RAZORPAY").refund({ paymentRef: order.gateway_payment_ref as string, amountMinor: input.amountMinor, currency: order.currency, refundId: refund.id });
  } catch (err) {
    const reason = err instanceof GatewayError ? err.message : "The gateway could not be reached";
    await settleRefund(refund.id, "FAILED", reason.slice(0, 300), actor.id);
    if (err instanceof GatewayError) throw err;
    captureError(err, { where: "requestRefund", orderId });
    throw new GatewayError(reason);
  }
  await refundRepo.setGatewayRef(refund.id, result.ref);
  if (result.status !== "PENDING") await settleRefund(refund.id, result.status, result.failureReason, actor.id);
  return { refundId: refund.id };
}

/** PENDING to SUCCEEDED/FAILED, with everything a settled refund implies. Idempotent. */
export async function settleRefund(refundId: string, status: "SUCCEEDED" | "FAILED", failureReason: string | null, actorId: string | null = null): Promise<string> {
  return withTransaction(async (trx, fx) => {
    const pre = await refundRepo.byId(refundId, trx);
    if (!pre) return "REFUND_NOT_FOUND";
    // Same lock order as fulfilment and refund requests: the order row first.
    const order = await orderRepo.lock(pre.order_id, trx);
    if (!order) return "ORDER_NOT_FOUND";
    if (!(await refundRepo.settle(refundId, status, failureReason, trx))) return "ALREADY_SETTLED";
    const refund = { ...pre, status, failure_reason: failureReason, settled_at: new Date() };
    if (status === "FAILED") {
      await audit({ actorId, action: "refund.failed", entityType: "order", entityId: order.id, data: { refundId, reason: failureReason } }, trx);
      return "REFUND_FAILED";
    }
    const refunded = order.refunded_minor + refund.amount_minor;
    const next = statusAfterRefund(order.total_minor, refunded);
    if (!(await orderRepo.addRefunded(order.id, refund.amount_minor, next, trx))) {
      // The gateway refunded more than the order allows: record it loudly, never corrupt the totals.
      await audit({ actorId, action: "refund.over_settled", entityType: "order", entityId: order.id, data: { refundId, amountMinor: refund.amount_minor } }, trx);
      return "REFUND_EXCEEDS_ORDER";
    }
    const note = await issueCreditNote({ ...order, refunded_minor: refunded, status: next }, refund, trx);
    if (refund.revoke_access) {
      const enrollments = await trx.selectFrom("enrollments").select("id").where("order_id", "=", order.id).where("status", "=", "ACTIVE").execute();
      for (const e of enrollments) await revokeEnrollment({ enrollmentId: e.id, reason: "Refunded", actorId }, trx, fx);
      if (order.kind === "SUBSCRIPTION") {
        const sub = await subscriptionRepo.byFirstOrder(order.id, trx);
        if (sub) fx.after(() => endSubscriptionForRefund(sub.id, actorId));
      }
    }
    await notify({ recipientId: order.user_id, actorId: null, type: "REFUND_ISSUED", entityType: "order", entityId: order.id, snippet: order.number, data: { orderId: order.id } }, fx, trx);
    await audit({ actorId, action: "refund.settle", entityType: "order", entityId: order.id, data: { refundId, amountMinor: refund.amount_minor, status: next, creditNote: note.number } }, trx);
    fx.job("invoices.render", { invoiceId: note.id });
    fx.job("notify.refund", { refundId });
    return "REFUND_SETTLED";
  });
}

/** A refunded plan with access revoked: end it at the gateway and here, now. */
async function endSubscriptionForRefund(subscriptionId: string, actorId: string | null): Promise<void> {
  const sub = await subscriptionRepo.byId(subscriptionId);
  if (!sub || sub.status === "EXPIRED" || (sub.status === "CANCELED" && !sub.cancel_at_period_end)) return;
  if (sub.gateway !== "FREE" && !sub.gateway_subscription_ref.startsWith("pending_")) {
    await gatewayOf(sub.gateway).cancelSubscription(sub.gateway_subscription_ref, { atPeriodEnd: false }).catch((err) => captureError(err, { where: "endSubscriptionForRefund", subscriptionId }));
  }
  await withTransaction(async (trx) => {
    const moved = await subscriptionRepo.update(sub.id, ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"], { status: "CANCELED", cancel_at_period_end: false, canceled_at: new Date(), current_period_end: new Date() }, trx);
    if (moved) await audit({ actorId, action: "subscription.cancel", entityType: "subscription", entityId: sub.id, data: { reason: "Refunded", atPeriodEnd: false } }, trx);
  });
}

/**
 * A REFUND_SUCCEEDED / REFUND_FAILED webhook. Found by the gateway's refund id; when the
 * webhook beat us to storing that id, by our id echoed in the refund's metadata (the
 * refund must then still have no gateway id, or the same one).
 */
export async function onRefundEvent(refs: string[], localRefundId: string | null, status: "SUCCEEDED" | "FAILED", failureReason: string | null): Promise<{ outcome: string; orderId: string | null }> {
  let outcome = "REFUND_NOT_FOUND";
  let orderId: string | null = null;
  for (const ref of refs) {
    let row = await refundRepo.byGatewayRef(ref);
    if (!row && localRefundId && refs.length === 1) {
      const local = await refundRepo.byId(localRefundId).catch(() => undefined);
      if (local && (local.gateway_refund_ref === null || local.gateway_refund_ref === ref)) {
        await refundRepo.setGatewayRef(local.id, ref);
        row = local;
      }
    }
    if (!row) continue;
    orderId = row.order_id;
    outcome = await settleRefund(row.id, status, failureReason);
  }
  return { outcome, orderId };
}
