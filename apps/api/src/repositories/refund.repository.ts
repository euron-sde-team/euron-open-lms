/**
 * Refund requests. A row is PENDING from the moment staff ask until the gateway says
 * yes or no; settling is a conditional UPDATE from PENDING, so a synchronous success and
 * the webhook that confirms it settle the refund once.
 */
import type { Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Refunds } from "../db/types";

export type RefundRow = Selectable<Refunds>;

export class RefundRepository {
  async insert(row: { id: string; order_id: string; amount_minor: number; reason: string; revoke_access: boolean; requested_by: string }, trx: Executor): Promise<void> {
    await trx.insertInto("refunds").values({ ...row, status: "PENDING" }).execute();
  }

  byId(id: string, exec: Executor = db): Promise<RefundRow | undefined> {
    return exec.selectFrom("refunds").selectAll().where("id", "=", id).executeTakeFirst();
  }

  byGatewayRef(ref: string, exec: Executor = db): Promise<RefundRow | undefined> {
    return exec.selectFrom("refunds").selectAll().where("gateway_refund_ref", "=", ref).executeTakeFirst();
  }

  forOrder(orderId: string, exec: Executor = db): Promise<RefundRow[]> {
    return exec.selectFrom("refunds").selectAll().where("order_id", "=", orderId).orderBy("created_at").orderBy("id").execute();
  }

  /** Sum of refunds still waiting on the gateway (they count against what is left to refund). */
  async pendingTotal(orderId: string, exec: Executor = db): Promise<number> {
    const r = await exec.selectFrom("refunds").select((eb) => eb.fn.coalesce(eb.fn.sum<number>("amount_minor"), eb.val(0)).as("n")).where("order_id", "=", orderId).where("status", "=", "PENDING").executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async setGatewayRef(id: string, ref: string, exec: Executor = db): Promise<void> {
    await exec.updateTable("refunds").set({ gateway_refund_ref: ref }).where("id", "=", id).where("gateway_refund_ref", "is", null).execute();
  }

  /** PENDING to SUCCEEDED or FAILED; false when it was already settled. */
  async settle(id: string, status: "SUCCEEDED" | "FAILED", failureReason: string | null, trx: Executor): Promise<boolean> {
    const r = await trx.updateTable("refunds").set({ status, failure_reason: failureReason, settled_at: new Date() }).where("id", "=", id).where("status", "=", "PENDING").executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }
}

export const refundRepo = new RefundRepository();
