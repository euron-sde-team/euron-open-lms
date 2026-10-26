/** Plans and price rows to DTOs: the public `Plan` list, `AdminPlan` and `AdminPrice`. */
import type { AdminPlan, AdminPrice, Plan, SellableType } from "@open-lms/types";
import type { Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Plans } from "../db/types";
import { money, type PriceRow } from "../repositories/price.repository";

export type PlanRow = Selectable<Plans>;

export function toAdminPrice(p: PriceRow & { active?: boolean }): AdminPrice {
  return { id: p.id, currency: p.currency, amount: money(p.amount_minor, p.currency), compareAt: p.compare_at_minor === null ? null : money(p.compare_at_minor, p.currency), interval: p.interval, active: p.active ?? true };
}

/** Active prices of many sellables, grouped by sellable id. */
export async function activePrices(type: SellableType, ids: readonly string[], exec: Executor = db): Promise<Map<string, PriceRow[]>> {
  const out = new Map<string, PriceRow[]>();
  if (!ids.length) return out;
  const rows = (await exec
    .selectFrom("prices")
    .select(["id", "sellable_type", "sellable_id", "currency", "amount_minor", "compare_at_minor", "interval", "gateway_refs"])
    .where("sellable_type", "=", type)
    .where("sellable_id", "in", [...new Set(ids)])
    .where("active", "=", true)
    .orderBy("currency")
    .orderBy("interval")
    .execute()) as PriceRow[];
  for (const r of rows) out.set(r.sellable_id, [...(out.get(r.sellable_id) ?? []), r]);
  return out;
}

/** Courses a plan unlocks: every published course included in subscriptions (plans are all-access). */
export async function includedCourseCount(exec: Executor = db): Promise<number> {
  const r = await exec.selectFrom("courses").select((eb) => eb.fn.countAll<number>().as("n")).where("status", "=", "PUBLISHED").where("included_in_subscription", "=", true).executeTakeFirstOrThrow();
  return Number(r.n);
}

export async function presentPlans(plans: PlanRow[], currency: string, exec: Executor = db): Promise<Plan[]> {
  const [prices, included] = await Promise.all([activePrices("PLAN", plans.map((p) => p.id), exec), includedCourseCount(exec)]);
  return plans.map((p) => ({
    id: p.id,
    slug: String(p.slug),
    name: p.name,
    description: p.description,
    features: p.features,
    trialDays: p.trial_days,
    prices: (prices.get(p.id) ?? []).filter((r) => r.currency === currency && r.interval).map((r) => ({ id: r.id, interval: r.interval as "MONTH" | "YEAR", price: money(r.amount_minor, r.currency) })),
    includedCourseCount: included,
  }));
}

export async function presentAdminPlans(plans: PlanRow[], exec: Executor = db): Promise<AdminPlan[]> {
  if (!plans.length) return [];
  const ids = plans.map((p) => p.id);
  const [prices, subs] = await Promise.all([
    activePrices("PLAN", ids, exec),
    exec.selectFrom("subscriptions").select(["plan_id", (eb) => eb.fn.countAll<number>().as("n")]).where("plan_id", "in", ids).where("status", "in", ["TRIALING", "ACTIVE", "PAST_DUE"]).groupBy("plan_id").execute(),
  ]);
  const counts = new Map(subs.map((s) => [s.plan_id, Number(s.n)]));
  return plans.map((p) => ({
    id: p.id,
    slug: String(p.slug),
    name: p.name,
    description: p.description,
    features: p.features,
    trialDays: p.trial_days,
    status: p.status,
    position: p.position,
    prices: (prices.get(p.id) ?? []).map(toAdminPrice),
    activeSubscribers: counts.get(p.id) ?? 0,
  }));
}
