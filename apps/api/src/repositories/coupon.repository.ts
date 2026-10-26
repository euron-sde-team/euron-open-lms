/**
 * Coupons, the things a SPECIFIC coupon applies to, and redemptions. The redemption
 * counter only moves by a conditional UPDATE (`redemption_count < max_redemptions`), so
 * concurrent payments can never push it past the cap (the table CHECK backs that up).
 */
import type { SellableType } from "@open-lms/types";
import { sql, type Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Coupons } from "../db/types";
import { atKey, olderThan, type TimeKey } from "./keyset";

export type CouponRow = Selectable<Coupons>;

export class CouponRepository {
  byCode(code: string, exec: Executor = db): Promise<CouponRow | undefined> {
    return exec.selectFrom("coupons").selectAll().where("code", "=", code).executeTakeFirst();
  }

  byId(id: string, exec: Executor = db): Promise<CouponRow | undefined> {
    return exec.selectFrom("coupons").selectAll().where("id", "=", id).executeTakeFirst();
  }

  async targets(couponIds: readonly string[], exec: Executor = db): Promise<Map<string, { type: SellableType; id: string }[]>> {
    const out = new Map<string, { type: SellableType; id: string }[]>();
    if (!couponIds.length) return out;
    const rows = await exec.selectFrom("coupon_targets").selectAll().where("coupon_id", "in", [...new Set(couponIds)]).execute();
    for (const r of rows) out.set(r.coupon_id, [...(out.get(r.coupon_id) ?? []), { type: r.sellable_type, id: r.sellable_id }]);
    return out;
  }

  async isTarget(couponId: string, type: SellableType, id: string, exec: Executor = db): Promise<boolean> {
    const r = await exec.selectFrom("coupon_targets").select("coupon_id").where("coupon_id", "=", couponId).where("sellable_type", "=", type).where("sellable_id", "=", id).executeTakeFirst();
    return !!r;
  }

  /** How many times this learner used the coupon on orders that were actually paid. */
  async userRedemptions(couponId: string, userId: string, exec: Executor = db): Promise<number> {
    const r = await exec
      .selectFrom("coupon_redemptions as r")
      .innerJoin("orders as o", "o.id", "r.order_id")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("r.coupon_id", "=", couponId)
      .where("r.user_id", "=", userId)
      .where("o.paid_at", "is not", null)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** Count one redemption if the cap allows. False when the coupon ran out meanwhile. */
  async incrementRedemption(couponId: string, trx: Executor): Promise<boolean> {
    const r = await trx
      .updateTable("coupons")
      .set((eb) => ({ redemption_count: eb("redemption_count", "+", 1), updated_at: new Date() }))
      .where("id", "=", couponId)
      .where(sql<boolean>`(max_redemptions IS NULL OR redemption_count < max_redemptions)`)
      .executeTakeFirst();
    return Number(r.numUpdatedRows) === 1;
  }

  async insertRedemption(row: { id: string; couponId: string; userId: string; orderId: string }, trx: Executor): Promise<void> {
    await trx.insertInto("coupon_redemptions").values({ id: row.id, coupon_id: row.couponId, user_id: row.userId, order_id: row.orderId }).onConflict((oc) => oc.column("order_id").doNothing()).execute();
  }

  list(f: { q?: string; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec.selectFrom("coupons").selectAll().select(atKey("created_at"));
    if (f.q?.trim()) q = q.where(sql<boolean>`code::text ILIKE ${`%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
    return q.where(olderThan("created_at", "id", f.cursor)).orderBy("created_at", "desc").orderBy("id", "desc").limit(f.limit + 1).execute();
  }

  async replaceTargets(couponId: string, targets: { type: SellableType; id: string }[], trx: Executor): Promise<void> {
    await trx.deleteFrom("coupon_targets").where("coupon_id", "=", couponId).execute();
    if (targets.length) await trx.insertInto("coupon_targets").values(targets.map((t) => ({ coupon_id: couponId, sellable_type: t.type, sellable_id: t.id }))).execute();
  }
}

export const couponRepo = new CouponRepository();
