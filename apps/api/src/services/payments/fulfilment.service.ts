/**
 * Fulfilment: the ONE function that turns money taken into access. Every path that
 * learns a payment succeeded calls `fulfilOrder`: the gateway webhook, the Razorpay
 * client return (after its signature and the captured payment are verified), the
 * return page asking Stripe (?sync=1), the reconcile job, and free orders.
 *
 * In one transaction:
 *   1. lock the order row (SELECT ... FOR UPDATE): concurrent callers queue here;
 *   2. already PAID (or refunded since)? done, a no-op: the second caller changes nothing;
 *   3. the captured amount and currency must equal what we priced (amountMatches). A
 *      mismatch is flagged (AMOUNT_MISMATCH) and audited, the order stays PENDING for
 *      staff review, and nothing is granted;
 *   4. conditional UPDATE to PAID (only from the statuses domain/orders.ts allows);
 *   5. grant every course (a bundle: each of its courses, source BUNDLE), or activate the
 *      subscription row for a plan (access then comes from domain/entitlements.ts);
 *   6. count the coupon redemption under its cap. A coupon that ran out between quote
 *      and payment still honours the price the buyer paid; the overrun is audited;
 *   7. issue the invoice with a gap-free number, notify ORDER_PAID;
 *   8. after commit: render the PDF and send the receipt.
 *
 * A failure event can only move PENDING to FAILED: money taken is never un-taken by a
 * late failure, only by a refund.
 */
import type { SubscriptionStatus } from "@open-lms/types";
import { withTransaction } from "../../core/effects";
import { captureError, logger } from "../../core/logger";
import { newId } from "../../core/ids";
import type { Executor } from "../../db/kysely";
import { amountMatches, sourcesOf } from "../../domain/orders";
import { couponRepo } from "../../repositories/coupon.repository";
import { orderRepo, type OrderRow } from "../../repositories/order.repository";
import { pendingRef, subscriptionRepo } from "../../repositories/subscription.repository";
import { audit } from "../audit.service";
import { grantEnrollment } from "../enrollment.service";
import { issueInvoice } from "../invoice.service";
import { notify } from "../notification.service";
import { gatewayOf } from "./gateways";

export interface Capture {
  amountMinor: number;
  currency: string;
  paymentRef: string | null;
  /** Subscriptions: the gateway's subscription id and what it says about the period. */
  subscriptionRef?: string | null;
  subscription?: { status?: SubscriptionStatus | null; periodStart?: Date | null; periodEnd?: Date | null; trialEnd?: Date | null } | null;
}

export type FulfilSource = "webhook" | "confirm" | "sync" | "reconcile" | "free" | "renewal";
export type FulfilOutcome = "FULFILLED" | "ALREADY_PAID" | "AMOUNT_MISMATCH" | "NOT_PAYABLE" | "NOT_FOUND";

const SETTLED = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

export async function fulfilOrder(orderId: string, capture: Capture, source: FulfilSource): Promise<{ outcome: FulfilOutcome; order: OrderRow | null }> {
  return withTransaction(async (trx, fx) => {
    const order = await orderRepo.lock(orderId, trx);
    if (!order) return { outcome: "NOT_FOUND" as const, order: null };
    if ((SETTLED as readonly string[]).includes(order.status)) return { outcome: "ALREADY_PAID" as const, order };
    if (!sourcesOf("PAID").includes(order.status)) {
      // Paid after the learner cancelled it: keep the money visible for staff, grant nothing.
      await orderRepo.flag(order.id, "PAID_AFTER_CANCEL", trx);
      await audit({ actorId: null, action: "order.paid_after_cancel", entityType: "order", entityId: order.id, data: { source, status: order.status, amountMinor: capture.amountMinor, currency: capture.currency, paymentRef: capture.paymentRef } }, trx);
      return { outcome: "NOT_PAYABLE" as const, order };
    }
    if (!amountMatches({ totalMinor: order.total_minor, currency: order.currency }, { amountMinor: capture.amountMinor, currency: capture.currency })) {
      await orderRepo.flag(order.id, "AMOUNT_MISMATCH", trx);
      await audit(
        { actorId: null, action: "order.amount_mismatch", entityType: "order", entityId: order.id, data: { source, expected: { amountMinor: order.total_minor, currency: order.currency }, captured: { amountMinor: capture.amountMinor, currency: capture.currency }, paymentRef: capture.paymentRef } },
        trx,
      );
      logger.warn({ orderId: order.id, source }, "payment amount does not match the order; not fulfilled");
      return { outcome: "AMOUNT_MISMATCH" as const, order };
    }
    if (!(await orderRepo.markPaid(order.id, { paymentRef: capture.paymentRef }, trx))) return { outcome: "ALREADY_PAID" as const, order };
    const paid = (await orderRepo.lock(order.id, trx)) as OrderRow;
    const items = (await orderRepo.items([order.id], trx)).get(order.id) ?? [];

    let subscriptionId: string | null = null;
    for (const item of items) {
      if (item.sellable_type === "COURSE") {
        await grantEnrollment({ userId: order.user_id, courseId: item.sellable_id, source: "PURCHASE", orderId: order.id }, trx, fx);
      } else if (item.sellable_type === "BUNDLE") {
        const courses = await trx.selectFrom("bundle_courses").select("course_id").where("bundle_id", "=", item.sellable_id).orderBy("position").execute();
        for (const c of courses) await grantEnrollment({ userId: order.user_id, courseId: c.course_id, source: "BUNDLE", bundleId: item.sellable_id, orderId: order.id }, trx, fx);
      } else {
        subscriptionId = await activateFirstPeriod(paid, capture, trx);
      }
    }

    if (order.coupon_id) {
      const counted = await couponRepo.incrementRedemption(order.coupon_id, trx);
      await couponRepo.insertRedemption({ id: newId(), couponId: order.coupon_id, userId: order.user_id, orderId: order.id }, trx);
      if (!counted) await audit({ actorId: null, action: "coupon.over_redeemed", entityType: "coupon", entityId: order.coupon_id, data: { orderId: order.id, code: order.coupon_code } }, trx);
    }

    const invoice = await issueInvoice(paid, items, trx, { subscriptionId });
    await notify({ recipientId: order.user_id, actorId: null, type: "ORDER_PAID", entityType: "order", entityId: order.id, snippet: items[0]?.title ?? order.number, data: { orderId: order.id } }, fx, trx);
    await audit({ actorId: null, action: "order.paid", entityType: "order", entityId: order.id, data: { source, gateway: order.gateway, totalMinor: order.total_minor, currency: order.currency, invoice: invoice.number } }, trx);
    fx.job("invoices.render", { invoiceId: invoice.id });
    fx.job("notify.receipt", { orderId: order.id });
    return { outcome: "FULFILLED" as const, order: paid };
  });
}

/** The plan's subscription row goes live with the first payment. */
async function activateFirstPeriod(order: OrderRow, capture: Capture, trx: Executor): Promise<string | null> {
  const sub = await subscriptionRepo.byFirstOrder(order.id, trx);
  if (!sub) return null;
  await subscriptionRepo.lock(sub.id, trx);
  if (capture.subscriptionRef && sub.gateway_subscription_ref === pendingRef(order.id)) await subscriptionRepo.setRef(sub.id, capture.subscriptionRef, trx);
  const now = new Date();
  const facts = capture.subscription ?? {};
  const trialEnd = facts.trialEnd ?? null;
  const start = facts.periodStart ?? now;
  // Until the gateway reports the period, assume one interval from now so access starts at once.
  const end = facts.periodEnd ?? trialEnd ?? new Date(now.getTime() + (sub.interval === "YEAR" ? 365 : 30) * 86_400_000);
  const status: SubscriptionStatus = facts.status && facts.status !== "INCOMPLETE" ? facts.status : trialEnd && trialEnd > now ? "TRIALING" : "ACTIVE";
  // A late payment for a checkout that was closed as abandoned revives its row, unless
  // the learner has another live subscription by now (one live row per learner).
  const other = await subscriptionRepo.live(order.user_id, trx);
  const from: SubscriptionStatus[] = other && other.id !== sub.id ? ["INCOMPLETE"] : ["INCOMPLETE", "EXPIRED"];
  const moved = await subscriptionRepo.update(sub.id, from, { status, current_period_start: start, current_period_end: end, trial_end: trialEnd }, trx);
  if (!moved) await audit({ actorId: null, action: "subscription.activation_skipped", entityType: "subscription", entityId: sub.id, data: { orderId: order.id, status: sub.status } }, trx);
  return sub.id;
}

/**
 * A payment failed (or its checkout expired) before money was taken: PENDING to FAILED
 * or EXPIRED. Never touches a paid order. The plan's INCOMPLETE row is closed too.
 */
export async function closeOrder(orderId: string, to: "FAILED" | "EXPIRED" | "CANCELED", reason: string | null, actorId: string | null = null): Promise<boolean> {
  return withTransaction(async (trx, fx) => {
    const order = await orderRepo.lock(orderId, trx);
    if (!order || order.status !== "PENDING") return false;
    if (!(await orderRepo.markClosed(order.id, to, reason, trx))) return false;
    await closeIncomplete(order.id, trx);
    if (to === "FAILED") await notify({ recipientId: order.user_id, actorId: null, type: "ORDER_FAILED", entityType: "order", entityId: order.id, snippet: order.number, data: { orderId: order.id } }, fx, trx);
    if (actorId) await audit({ actorId, action: `order.${to.toLowerCase()}`, entityType: "order", entityId: order.id, data: { reason } }, trx);
    return true;
  });
}

/** An abandoned plan checkout must not keep the learner's one live-subscription slot. */
export async function closeIncomplete(orderId: string, trx: Executor): Promise<void> {
  const sub = await subscriptionRepo.byFirstOrder(orderId, trx);
  if (sub) await subscriptionRepo.update(sub.id, ["INCOMPLETE"], { status: "EXPIRED" }, trx);
}

/**
 * Ask the gateway about a PENDING order and act on the answer: fulfil when it says
 * paid, expire when the checkout is gone (or, for the reconcile job, when our payment
 * window closed and the gateway has no payment). Returns the outcome for logs.
 */
export async function syncWithGateway(order: OrderRow, mode: "return-page" | "reconcile"): Promise<string> {
  if (order.status !== "PENDING") return "NOT_PENDING";
  if (order.gateway === "FREE" || !order.gateway_ref) {
    if (mode === "reconcile" && (await closeOrder(order.id, "EXPIRED", "PAYMENT_WINDOW_CLOSED"))) return "EXPIRED";
    return "NO_GATEWAY_REF";
  }
  let status;
  try {
    status = await gatewayOf(order.gateway).fetchOrderStatus({ gatewayRef: order.gateway_ref, kind: order.kind });
  } catch (err) {
    captureError(err, { where: "syncWithGateway", orderId: order.id });
    return "GATEWAY_UNREACHABLE";
  }
  if (status.state === "PAID") {
    const sub = order.kind === "SUBSCRIPTION" && status.subscriptionRef ? await gatewayOf(order.gateway).fetchSubscription(status.subscriptionRef).catch(() => null) : null;
    const r = await fulfilOrder(order.id, { amountMinor: status.amountMinor, currency: status.currency, paymentRef: status.paymentRef, subscriptionRef: status.subscriptionRef, subscription: sub }, mode === "reconcile" ? "reconcile" : "sync");
    return r.outcome;
  }
  if (status.state === "EXPIRED" || (mode === "reconcile" && status.state !== "UNKNOWN" && order.expires_at < new Date())) {
    return (await closeOrder(order.id, "EXPIRED", "PAYMENT_WINDOW_CLOSED")) ? "EXPIRED" : "NOT_PENDING";
  }
  return status.state;
}

/** The reconcile job: every PENDING order past its window, oldest first. */
export async function reconcilePending(batch = 100): Promise<{ checked: number }> {
  const orders = await orderRepo.pendingExpired(batch);
  for (const order of orders) {
    try {
      await syncWithGateway(order, "reconcile");
    } catch (err) {
      captureError(err, { where: "reconcilePending", orderId: order.id });
    }
  }
  return { checked: orders.length };
}
