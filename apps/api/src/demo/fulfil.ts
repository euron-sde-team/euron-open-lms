/**
 * Paying and refunding demo orders through the real commerce services: the same
 * fulfilment a verified webhook runs (enrollments, coupon redemption, gap-free invoice
 * numbers, receipts) and the same refund settlement a gateway's refund event runs
 * (credit note, revoked access). Only the gateway call itself is skipped, then the
 * timestamps are moved back to when the demo says it happened.
 */
import { randomBytes } from "node:crypto";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { fulfilOrder } from "../services/payments/fulfilment.service";
import { settleRefund } from "../services/refund.service";

export async function fulfilDemoOrder(orderId: string, at: Date): Promise<void> {
  const order = await db.selectFrom("orders").select(["total_minor", "currency", "gateway"]).where("id", "=", orderId).executeTakeFirstOrThrow();
  const paymentRef = `${order.gateway === "RAZORPAY" ? "pay_demo_" : "pi_demo_"}${randomBytes(7).toString("hex")}`;
  const { outcome } = await fulfilOrder(orderId, { amountMinor: order.total_minor, currency: order.currency, paymentRef }, "webhook");
  if (outcome !== "FULFILLED") throw new Error(`demo order ${orderId} was not fulfilled: ${outcome}`);
  await db.updateTable("orders").set({ paid_at: at, created_at: at, updated_at: at }).where("id", "=", orderId).execute();
  await db.updateTable("invoices").set({ issued_at: at }).where("order_id", "=", orderId).execute();
  await db.updateTable("enrollments").set({ created_at: at }).where("order_id", "=", orderId).execute();
  await db.updateTable("coupon_redemptions").set({ created_at: at }).where("order_id", "=", orderId).execute();
}

export async function refundDemoOrder(orderId: string, actorId: string, reason: string): Promise<void> {
  const order = await db.selectFrom("orders").select(["total_minor", "paid_at"]).where("id", "=", orderId).executeTakeFirstOrThrow();
  const refundId = newId();
  await db
    .insertInto("refunds")
    .values({ id: refundId, order_id: orderId, amount_minor: order.total_minor, reason, revoke_access: true, requested_by: actorId, gateway_refund_ref: `re_demo_${randomBytes(7).toString("hex")}` })
    .execute();
  await settleRefund(refundId, "SUCCEEDED", null, actorId);
  const at = new Date((order.paid_at?.getTime() ?? Date.now()) + 2 * 86_400_000);
  await db.updateTable("refunds").set({ created_at: at, settled_at: at }).where("id", "=", refundId).execute();
}
