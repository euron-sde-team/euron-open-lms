/**
 * The learner's billing pages: their orders, invoices (PDF downloads are owner-only, see
 * invoice.service.ts) and subscription. Every list is the caller's own rows only; ids
 * from someone else are 404, never 403, so they cannot even be confirmed to exist.
 */
import type { Invoice, Order, Page, SubscriptionSummary } from "@open-lms/types";
import type { Actor } from "../core/context";
import { presentOrders } from "../presenters/order.presenter";
import { liveSubscriptionOf } from "../presenters/subscription.presenter";
import { invoiceRepo } from "../repositories/invoice.repository";
import { decodeTime, timePage } from "../repositories/keyset";
import { orderRepo } from "../repositories/order.repository";
import { money } from "../repositories/price.repository";
import { invoiceDownloadUrl } from "./invoice.service";
import { cancelMine, resumeMine } from "./subscription.service";

export async function myOrders(actor: Actor, q: { cursor?: string; limit?: number }): Promise<Page<Order>> {
  const limit = q.limit ?? 20;
  const page = timePage(await orderRepo.listForUser(actor.id, decodeTime(q.cursor), limit), limit);
  return { items: await presentOrders(page.items), nextCursor: page.nextCursor };
}

export async function myInvoices(actor: Actor, q: { cursor?: string; limit?: number }): Promise<Page<Invoice>> {
  const limit = q.limit ?? 20;
  const page = timePage(await invoiceRepo.listForUser(actor.id, decodeTime(q.cursor), limit), limit);
  return {
    items: page.items.map((i) => ({ id: i.id, number: i.number, kind: i.kind, orderNumber: i.order_number ?? null, total: money(i.total_minor, i.currency), issuedAt: i.issued_at.toISOString(), ready: !!i.pdf_key })),
    nextCursor: page.nextCursor,
  };
}

export function invoicePdfUrl(actor: Actor, invoiceId: string): Promise<string> {
  return invoiceDownloadUrl(actor, invoiceId);
}

export function mySubscription(actor: Actor): Promise<SubscriptionSummary | null> {
  return liveSubscriptionOf(actor.id);
}

export function cancelMySubscription(actor: Actor, ip: string | null): Promise<SubscriptionSummary> {
  return cancelMine(actor, ip);
}

export function resumeMySubscription(actor: Actor, ip: string | null): Promise<SubscriptionSummary> {
  return resumeMine(actor, ip);
}
