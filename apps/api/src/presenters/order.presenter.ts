/**
 * Order rows to DTOs: the learner's `Order`, and the admin `AdminOrderRow` /
 * `AdminOrderDetail`. Everything is batch-loaded (lines, slugs, invoices, buyers), so a
 * page of orders costs a fixed number of queries.
 *
 * Learner DTOs never carry gateway references, payment ids or billing details beyond
 * what the learner typed; admin DTOs add the timeline staff need, with the stored
 * event payloads left out (they are redacted, but staff only need type and outcome).
 */
import type { AdminOrderDetail, AdminOrderRow, Order, OrderLine, UserSummary } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { invoiceRepo } from "../repositories/invoice.repository";
import { orderRepo, type OrderItemRow, type OrderRow } from "../repositories/order.repository";
import { money } from "../repositories/price.repository";
import { refundRepo } from "../repositories/refund.repository";
import { loadSummaries } from "./user.presenter";

/** Slugs of the things on the lines, for links on the receipt. */
async function slugsFor(items: OrderItemRow[], exec: Executor): Promise<Map<string, string>> {
  const ids = (t: string) => [...new Set(items.filter((i) => i.sellable_type === t).map((i) => i.sellable_id))];
  const [courses, bundles, plans] = await Promise.all([
    ids("COURSE").length ? exec.selectFrom("courses").select(["id", "slug"]).where("id", "in", ids("COURSE")).execute() : [],
    ids("BUNDLE").length ? exec.selectFrom("bundles").select(["id", "slug"]).where("id", "in", ids("BUNDLE")).execute() : [],
    ids("PLAN").length ? exec.selectFrom("plans").select(["id", "slug"]).where("id", "in", ids("PLAN")).execute() : [],
  ]);
  return new Map([...courses, ...bundles, ...plans].map((r) => [r.id, String(r.slug)]));
}

function taxLabelOf(order: OrderRow): string | null {
  const t = (order.tax ?? {}) as { label?: string | null; rateBps?: number };
  return t.rateBps ? (t.label ?? null) : null;
}

function lineOf(i: OrderItemRow, currency: string, slug: string | null): OrderLine {
  return { type: i.sellable_type, id: i.sellable_id, title: i.title, slug, unit: money(i.unit_minor, currency), discount: money(i.discount_minor, currency), tax: money(i.tax_minor, currency), total: money(i.total_minor, currency) };
}

/** Where the learner goes after paying: the course itself, or My Learning for bundles and plans. */
function continueTo(order: OrderRow, lines: OrderLine[]): string | null {
  if (!["PAID", "PARTIALLY_REFUNDED"].includes(order.status)) return null;
  const course = lines.find((l) => l.type === "COURSE" && l.slug);
  return course ? `/learn/${course.slug}` : "/my-learning";
}

export async function presentOrders(orders: OrderRow[], exec: Executor = db): Promise<Order[]> {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const [items, invoices] = await Promise.all([orderRepo.items(ids, exec), invoiceRepo.forOrders(ids, exec)]);
  const slugs = await slugsFor([...items.values()].flat(), exec);
  return orders.map((o) => {
    const lines = (items.get(o.id) ?? []).map((i) => lineOf(i, o.currency, slugs.get(i.sellable_id) ?? null));
    return {
      id: o.id,
      number: o.number,
      kind: o.kind,
      status: o.status,
      gateway: o.gateway,
      lines,
      subtotal: money(o.subtotal_minor, o.currency),
      discount: money(o.discount_minor, o.currency),
      tax: money(o.tax_minor, o.currency),
      total: money(o.total_minor, o.currency),
      refunded: money(o.refunded_minor, o.currency),
      couponCode: o.coupon_code ? String(o.coupon_code) : null,
      taxLabel: taxLabelOf(o),
      // Learners see why a payment failed; staff-review flags stay internal.
      failureReason: o.status === "FAILED" || o.status === "EXPIRED" ? o.failure_reason : null,
      paidAt: o.paid_at?.toISOString() ?? null,
      createdAt: o.created_at.toISOString(),
      invoice: invoices.get(o.id) ?? null,
      continueTo: continueTo(o, lines),
    };
  });
}

export async function presentOrder(order: OrderRow, exec: Executor = db): Promise<Order> {
  return (await presentOrders([order], exec))[0] as Order;
}

type AdminRowInput = OrderRow & { user_email?: string };

export async function presentAdminRows(orders: AdminRowInput[], exec: Executor = db): Promise<AdminOrderRow[]> {
  if (!orders.length) return [];
  const [items, users, emails] = await Promise.all([
    orderRepo.items(orders.map((o) => o.id), exec),
    loadSummaries(orders.map((o) => o.user_id), exec),
    orders.every((o) => o.user_email) ? Promise.resolve(new Map(orders.map((o) => [o.user_id, o.user_email as string]))) : exec.selectFrom("users").select(["id", "email"]).where("id", "in", [...new Set(orders.map((o) => o.user_id))]).execute().then((r) => new Map(r.map((u) => [u.id, u.email]))),
  ]);
  return orders.map((o) => {
    const lines = items.get(o.id) ?? [];
    const user = users.get(o.user_id) as UserSummary;
    return {
      id: o.id,
      number: o.number,
      kind: o.kind,
      status: o.status,
      gateway: o.gateway,
      user: { ...(user ?? { id: o.user_id, username: "deleted", displayName: "Deleted user", avatarUrl: null, headline: null, role: "LEARNER" }), email: emails.get(o.user_id) ?? "" },
      title: lines.length > 1 ? `${lines[0]?.title} and ${lines.length - 1} more` : (lines[0]?.title ?? o.number),
      total: money(o.total_minor, o.currency),
      refunded: money(o.refunded_minor, o.currency),
      couponCode: o.coupon_code ? String(o.coupon_code) : null,
      createdAt: o.created_at.toISOString(),
      paidAt: o.paid_at?.toISOString() ?? null,
    };
  });
}

export async function presentAdminDetail(order: OrderRow, exec: Executor = db): Promise<AdminOrderDetail> {
  const [[row], items, events, refunds, enrollments, invoices, pending] = await Promise.all([
    presentAdminRows([order], exec),
    orderRepo.items([order.id], exec),
    orderRepo.eventsFor(order.id, exec),
    refundRepo.forOrder(order.id, exec),
    exec.selectFrom("enrollments as e").innerJoin("courses as c", "c.id", "e.course_id").select(["e.id", "e.status", "c.title"]).where("e.order_id", "=", order.id).orderBy("c.title").execute(),
    invoiceRepo.allForOrder(order.id, exec),
    refundRepo.pendingTotal(order.id, exec),
  ]);
  const requesters = await loadSummaries(refunds.map((r) => r.requested_by), exec);
  const c = order.currency;
  const billing = Object.fromEntries(Object.entries((order.billing ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string]));
  const refundable = ["PAID", "PARTIALLY_REFUNDED"].includes(order.status) && order.gateway !== "FREE" ? Math.max(0, order.total_minor - order.refunded_minor - pending) : 0;
  return {
    ...(row as AdminOrderRow),
    lines: (items.get(order.id) ?? []).map((i) => ({ type: i.sellable_type, id: i.sellable_id, title: i.title, unit: money(i.unit_minor, c), discount: money(i.discount_minor, c), tax: money(i.tax_minor, c), total: money(i.total_minor, c) })),
    subtotal: money(order.subtotal_minor, c),
    discount: money(order.discount_minor, c),
    tax: money(order.tax_minor, c),
    taxLabel: taxLabelOf(order),
    billing,
    gatewayRef: order.gateway_ref,
    gatewayPaymentRef: order.gateway_payment_ref,
    failureReason: order.failure_reason,
    events: events.map((e) => ({ id: e.id, type: e.type, outcome: e.outcome, receivedAt: e.received_at.toISOString() })),
    refunds: refunds.map((r) => ({ id: r.id, amount: money(r.amount_minor, c), reason: r.reason, status: r.status, revokeAccess: r.revoke_access, requestedBy: r.requested_by ? (requesters.get(r.requested_by) ?? null) : null, createdAt: r.created_at.toISOString(), settledAt: r.settled_at?.toISOString() ?? null })),
    enrollments: enrollments.map((e) => ({ id: e.id, courseTitle: e.title, status: e.status })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, kind: i.kind })),
    refundable: money(refundable, c),
  };
}
