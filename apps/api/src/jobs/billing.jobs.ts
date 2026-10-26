/**
 * Billing jobs:
 *   invoices.render               draw and store an invoice or credit note PDF (idempotent)
 *   billing.reconcile-pending     PENDING orders past their window: ask the gateway, then fulfil or expire
 *   billing.expire-subscriptions  periods (plus grace) that ended become EXPIRED
 *   notify.receipt / notify.refund   the always-sent money emails
 */
import { config } from "../core/config";
import { db } from "../db/kysely";
import { receiptEmail, refundEmail } from "../integrations/mail/commerce-templates";
import { sendMail } from "../integrations/mail/mailer";
import { redis } from "../integrations/redis";
import { orderRepo } from "../repositories/order.repository";
import { refundRepo } from "../repositories/refund.repository";
import { renderInvoice } from "../services/invoice.service";
import { reconcilePending } from "../services/payments/fulfilment.service";
import { academyName } from "../services/settings.service";
import { expireSubscriptions } from "../services/subscription.service";
import { registerJob } from "./registry";

function orderLink(orderId: string): string {
  return `${config.APP_WEB_URL.replace(/\/$/, "")}/account/orders/${orderId}`;
}

/**
 * Claim a money email once: a retried job, or fulfilment reached from both the webhook
 * and the return page, must not mail the learner twice. 60 days outlives any retry.
 */
async function claimOnce(key: string): Promise<boolean> {
  return (await redis().set(`mail-once:${key}`, "1", "EX", 60 * 86_400, "NX")) === "OK";
}

async function sendReceipt(orderId: string): Promise<void> {
  const order = await orderRepo.byId(orderId);
  if (!order || !order.paid_at) return;
  if (!(await claimOnce(`receipt:${order.id}`))) return;
  const user = await db.selectFrom("users").select(["email", "display_name", "status"]).where("id", "=", order.user_id).executeTakeFirst();
  if (!user || user.status === "DEACTIVATED") return;
  const items = (await orderRepo.items([order.id])).get(order.id) ?? [];
  const tax = (order.tax ?? {}) as { label?: string | null };
  await sendMail(
    receiptEmail(await academyName(), user.email, user.display_name, {
      orderNumber: order.number,
      currency: order.currency,
      lines: items.map((i) => ({ title: i.title, totalMinor: i.total_minor })),
      discountMinor: order.discount_minor,
      taxMinor: order.tax_minor,
      taxLabel: tax.label ?? null,
      totalMinor: order.total_minor,
      renewal: order.idempotency_key.startsWith("renewal:"),
      link: orderLink(order.id),
    }),
  );
}

async function sendRefund(refundId: string): Promise<void> {
  const refund = await refundRepo.byId(refundId);
  if (!refund || refund.status !== "SUCCEEDED") return;
  if (!(await claimOnce(`refund:${refund.id}`))) return;
  const order = await orderRepo.byId(refund.order_id);
  if (!order) return;
  const user = await db.selectFrom("users").select(["email", "display_name"]).where("id", "=", order.user_id).executeTakeFirst();
  if (!user) return;
  await sendMail(refundEmail(await academyName(), user.email, user.display_name, { orderNumber: order.number, amountMinor: refund.amount_minor, currency: order.currency, full: order.status === "REFUNDED", link: orderLink(order.id) }));
}

export function registerBillingJobs(): void {
  registerJob("invoices.render", async ({ invoiceId }) => renderInvoice(invoiceId));
  registerJob("billing.reconcile-pending", async () => {
    await reconcilePending();
  });
  registerJob("billing.expire-subscriptions", async () => {
    await expireSubscriptions();
  });
  registerJob("notify.receipt", async ({ orderId }) => sendReceipt(orderId));
  registerJob("notify.refund", async ({ refundId }) => sendRefund(refundId));
}
