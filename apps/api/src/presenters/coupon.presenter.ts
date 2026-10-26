/** Coupon rows to `AdminCoupon`, with each target's title batch-loaded. */
import type { AdminCoupon, SellableType } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { couponRepo, type CouponRow } from "../repositories/coupon.repository";
import { money } from "../repositories/price.repository";

/** Titles of courses, bundles and plans by id. */
export async function sellableTitles(targets: { type: SellableType; id: string }[], exec: Executor = db): Promise<Map<string, string>> {
  const ids = (t: SellableType) => [...new Set(targets.filter((x) => x.type === t).map((x) => x.id))];
  const [courses, bundles, plans] = await Promise.all([
    ids("COURSE").length ? exec.selectFrom("courses").select(["id", "title"]).where("id", "in", ids("COURSE")).execute() : [],
    ids("BUNDLE").length ? exec.selectFrom("bundles").select(["id", "title"]).where("id", "in", ids("BUNDLE")).execute() : [],
    ids("PLAN").length ? exec.selectFrom("plans").select(["id", "name as title"]).where("id", "in", ids("PLAN")).execute() : [],
  ]);
  return new Map([...courses, ...bundles, ...plans].map((r) => [r.id, r.title]));
}

export async function presentCoupons(rows: CouponRow[], exec: Executor = db): Promise<AdminCoupon[]> {
  if (!rows.length) return [];
  const targets = await couponRepo.targets(rows.map((r) => r.id), exec);
  const titles = await sellableTitles([...targets.values()].flat(), exec);
  return rows.map((c) => ({
    id: c.id,
    code: String(c.code),
    description: c.description,
    kind: c.kind,
    percentOff: c.percent_off,
    amountOff: c.amount_off_minor !== null && c.currency ? money(c.amount_off_minor, c.currency) : null,
    scope: c.scope,
    targets: (targets.get(c.id) ?? []).map((t) => ({ type: t.type, id: t.id, title: titles.get(t.id) ?? "" })),
    maxRedemptions: c.max_redemptions,
    redemptionCount: c.redemption_count,
    perUserLimit: c.per_user_limit,
    startsAt: c.starts_at?.toISOString() ?? null,
    expiresAt: c.expires_at?.toISOString() ?? null,
    active: c.active,
    createdAt: c.created_at.toISOString(),
  }));
}
