/**
 * Orders, their lines, the verified gateway events stored against them, and the
 * gateway customer cache. Every status move is a conditional UPDATE on the statuses
 * domain/orders.ts allows (`sourcesOf(to)`), and callers check the row count: two
 * deliveries of one webhook, or a webhook racing the browser's return, can never both
 * apply a move.
 */
import type { OrderStatus } from "@open-lms/types";
import { sql, type Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Gateway, OrderItems, Orders } from "../db/types";
import { sourcesOf } from "../domain/orders";
import { atKey, olderThan, type TimeKey } from "./keyset";
import { userNameLike } from "./text-search";

export type OrderRow = Selectable<Orders>;
export type OrderItemRow = Selectable<OrderItems>;

export interface NewOrder {
  id: string;
  number: string;
  user_id: string;
  kind: "ONE_TIME" | "SUBSCRIPTION";
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  coupon_id: string | null;
  coupon_code: string | null;
  gateway: Gateway;
  tax: string;
  billing: string;
  plan_id: string | null;
  price_id: string | null;
  idempotency_key: string;
  expires_at: Date;
}

export class OrderRepository {
  /** Insert a PENDING order, or nothing when the (user, idempotency key) pair exists. */
  async insert(order: NewOrder, items: Omit<OrderItemRow, "order_id">[], exec: Executor): Promise<boolean> {
    const row = await exec.insertInto("orders").values(order).onConflict((oc) => oc.columns(["user_id", "idempotency_key"]).doNothing()).returning("id").executeTakeFirst();
    if (!row) return false;
    if (items.length) await exec.insertInto("order_items").values(items.map((i) => ({ ...i, order_id: order.id }))).execute();
    return true;
  }

  byId(id: string, exec: Executor = db): Promise<OrderRow | undefined> {
    return exec.selectFrom("orders").selectAll().where("id", "=", id).executeTakeFirst();
  }

  /** Lock the order row for the rest of the transaction (fulfilment, refunds). */
  lock(id: string, trx: Executor): Promise<OrderRow | undefined> {
    return trx.selectFrom("orders").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  byIdempotencyKey(userId: string, key: string, exec: Executor = db): Promise<OrderRow | undefined> {
    return exec.selectFrom("orders").selectAll().where("user_id", "=", userId).where("idempotency_key", "=", key).executeTakeFirst();
  }

  byGatewayRef(gateway: Gateway, ref: string, exec: Executor = db): Promise<OrderRow | undefined> {
    return exec.selectFrom("orders").selectAll().where("gateway", "=", gateway).where("gateway_ref", "=", ref).executeTakeFirst();
  }

  byPaymentRef(gateway: Gateway, ref: string, exec: Executor = db): Promise<OrderRow | undefined> {
    return exec.selectFrom("orders").selectAll().where("gateway", "=", gateway).where("gateway_payment_ref", "=", ref).orderBy("created_at", "asc").executeTakeFirst();
  }

  async items(orderIds: readonly string[], exec: Executor = db): Promise<Map<string, OrderItemRow[]>> {
    const out = new Map<string, OrderItemRow[]>();
    if (!orderIds.length) return out;
    const rows = await exec.selectFrom("order_items").selectAll().where("order_id", "in", [...new Set(orderIds)]).orderBy("id").execute();
    for (const r of rows) out.set(r.order_id, [...(out.get(r.order_id) ?? []), r]);
    return out;
  }

  /** Record the gateway's checkout reference once (it is created after the order row). */
  async setGatewayRef(id: string, ref: string, exec: Executor = db): Promise<boolean> {
    const r = await exec.updateTable("orders").set({ gateway_ref: ref, updated_at: new Date() }).where("id", "=", id).where("gateway_ref", "is", null).executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }

  /** PENDING/FAILED/EXPIRED to PAID. False when another path already moved it. */
  async markPaid(id: string, set: { paymentRef: string | null }, trx: Executor): Promise<boolean> {
    const r = await trx
      .updateTable("orders")
      .set({ status: "PAID", paid_at: new Date(), gateway_payment_ref: set.paymentRef, failure_reason: null, updated_at: new Date() })
      .where("id", "=", id)
      .where("status", "in", sourcesOf("PAID"))
      .executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }

  /** A conditional move to FAILED, EXPIRED or CANCELED (only ever from PENDING). */
  async markClosed(id: string, to: Extract<OrderStatus, "FAILED" | "EXPIRED" | "CANCELED">, reason: string | null, exec: Executor = db): Promise<boolean> {
    const r = await exec
      .updateTable("orders")
      .set({ status: to, failure_reason: reason, updated_at: new Date() })
      .where("id", "=", id)
      .where("status", "in", sourcesOf(to))
      .executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }

  /** Note why an order needs staff review without moving it (an amount mismatch). */
  async flag(id: string, reason: string, exec: Executor = db): Promise<void> {
    await exec.updateTable("orders").set({ failure_reason: reason, updated_at: new Date() }).where("id", "=", id).execute();
  }

  /** Add a settled refund to the order and move it along PAID, PARTIALLY_REFUNDED, REFUNDED. */
  async addRefunded(id: string, amountMinor: number, to: OrderStatus, trx: Executor): Promise<boolean> {
    const r = await trx
      .updateTable("orders")
      .set((eb) => ({ refunded_minor: eb("refunded_minor", "+", amountMinor), status: to, updated_at: new Date() }))
      .where("id", "=", id)
      .where("status", "in", sourcesOf(to))
      .where(sql<boolean>`refunded_minor + ${amountMinor} <= total_minor`)
      .executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }

  /** PENDING orders whose payment window closed: the reconcile job asks the gateway about each. */
  pendingExpired(limit: number, exec: Executor = db): Promise<OrderRow[]> {
    // An order flagged for an amount mismatch waits for staff; asking the gateway again
    // would only repeat the same audit entry every run.
    return exec
      .selectFrom("orders")
      .selectAll()
      .where("status", "=", "PENDING")
      .where("expires_at", "<", new Date())
      .where((eb) => eb.or([eb("failure_reason", "is", null), eb("failure_reason", "<>", "AMOUNT_MISMATCH")]))
      .orderBy("expires_at")
      .limit(limit)
      .execute();
  }

  listForUser(userId: string, cursor: TimeKey | null, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("orders")
      .selectAll()
      .select(atKey("created_at"))
      .where("user_id", "=", userId)
      .where(olderThan("created_at", "id", cursor))
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit + 1)
      .execute();
  }

  /** Admin search: an order number, a buyer's email or name, by status and gateway. Keyset by (created_at, id). */
  adminSearch(f: { q?: string; status?: OrderStatus; gateway?: Gateway; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec.selectFrom("orders as o").innerJoin("users as u", "u.id", "o.user_id").selectAll("o").select([atKey("o.created_at"), "u.email as user_email"]);
    if (f.status) q = q.where("o.status", "=", f.status);
    if (f.gateway) q = q.where("o.gateway", "=", f.gateway);
    const term = f.q?.trim();
    if (term) {
      if (/^ORD-[23456789A-HJ-NP-Z]{8}$/i.test(term)) q = q.where("o.number", "=", term.toUpperCase());
      else q = q.where(userNameLike("u", term));
    }
    return q.where(olderThan("o.created_at", "o.id", f.cursor)).orderBy("o.created_at", "desc").orderBy("o.id", "desc").limit(f.limit + 1).execute();
  }

  /** One page of orders created in [from, to), oldest first, for the CSV export. */
  exportPage(from: Date, to: Date, after: { at: Date; id: string } | null, limit: number, exec: Executor = db) {
    let q = exec
      .selectFrom("orders as o")
      .innerJoin("users as u", "u.id", "o.user_id")
      .select(["o.id", "o.number", "o.created_at", "o.paid_at", "o.status", "o.kind", "o.gateway", "o.currency", "o.subtotal_minor", "o.discount_minor", "o.tax_minor", "o.total_minor", "o.refunded_minor", "o.coupon_code", "o.tax", "o.billing", "u.email", "u.username"])
      .where("o.created_at", ">=", from)
      .where("o.created_at", "<", to);
    if (after) q = q.where(sql<boolean>`(o.created_at, o.id) > (${after.at}, ${after.id})`);
    return q.orderBy("o.created_at", "asc").orderBy("o.id", "asc").limit(limit).execute();
  }

  // ─── Gateway events ───────────────────────────────────────────────────────

  /** Store a verified event once. Null when (gateway, event_id) was already stored: a redelivery. */
  async insertEvent(e: { id: string; gateway: Gateway; eventId: string; type: string; payload: string }, exec: Executor = db): Promise<string | null> {
    const r = await exec
      .insertInto("payment_events")
      .values({ id: e.id, gateway: e.gateway, event_id: e.eventId, type: e.type, payload: e.payload })
      .onConflict((oc) => oc.columns(["gateway", "event_id"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    return r?.id ?? null;
  }

  async finishEvent(id: string, set: { outcome: string; orderId: string | null; subscriptionId: string | null }, exec: Executor = db): Promise<void> {
    await exec.updateTable("payment_events").set({ outcome: set.outcome.slice(0, 200), order_id: set.orderId, subscription_id: set.subscriptionId, processed_at: new Date() }).where("id", "=", id).execute();
  }

  async deleteEvent(id: string, exec: Executor = db): Promise<void> {
    await exec.deleteFrom("payment_events").where("id", "=", id).execute();
  }

  eventsFor(orderId: string, exec: Executor = db) {
    return exec.selectFrom("payment_events").select(["id", "type", "outcome", "received_at"]).where("order_id", "=", orderId).orderBy("received_at").orderBy("id").limit(200).execute();
  }

  // ─── Gateway customers ────────────────────────────────────────────────────

  async customerRef(userId: string, gateway: Gateway, exec: Executor = db): Promise<string | null> {
    const r = await exec.selectFrom("gateway_customers").select("customer_ref").where("user_id", "=", userId).where("gateway", "=", gateway).executeTakeFirst();
    return r?.customer_ref ?? null;
  }

  /** Keep the first customer stored for a user (a concurrent create loses and reads the winner). */
  async saveCustomerRef(userId: string, gateway: Gateway, ref: string, exec: Executor = db): Promise<string> {
    await exec.insertInto("gateway_customers").values({ user_id: userId, gateway, customer_ref: ref }).onConflict((oc) => oc.columns(["user_id", "gateway"]).doNothing()).execute();
    return (await this.customerRef(userId, gateway, exec)) ?? ref;
  }
}

export const orderRepo = new OrderRepository();
