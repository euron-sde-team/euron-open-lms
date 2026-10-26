/** Subscription rows to DTOs. */
import type { AdminSubscriptionRow, SubscriptionSummary } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { subscriptionGrantsAccess } from "../domain/entitlements";
import { getSettings } from "../services/settings.service";
import { loadSummaries } from "./user.presenter";

/** The learner's live (or still-paid-for, cancelled) subscription, if any. */
export async function liveSubscriptionOf(userId: string, exec: Executor = db): Promise<SubscriptionSummary | null> {
  const row = await exec
    .selectFrom("subscriptions as s")
    .innerJoin("plans as p", "p.id", "s.plan_id")
    .select([
      "s.id",
      "s.status",
      "s.interval",
      "s.currency",
      "s.amount_minor",
      "s.current_period_end",
      "s.trial_end",
      "s.cancel_at_period_end",
      "s.gateway",
      "p.id as plan_id",
      "p.slug as plan_slug",
      "p.name as plan_name",
    ])
    .where("s.user_id", "=", userId)
    .where("s.status", "in", ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"])
    .orderBy("s.created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  const { learning } = await getSettings(exec);
  const grantsAccess = subscriptionGrantsAccess({ status: row.status, currentPeriodEnd: row.current_period_end, trialEnd: row.trial_end }, new Date(), learning.subscriptionGraceDays);
  // A cancelled subscription whose paid period is over is history, not "yours".
  if (row.status === "CANCELED" && !grantsAccess) return null;
  return {
    id: row.id,
    plan: { id: row.plan_id, slug: String(row.plan_slug), name: row.plan_name },
    status: row.status,
    interval: row.interval,
    price: { amountMinor: row.amount_minor, currency: row.currency },
    currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
    trialEnd: row.trial_end?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    gateway: row.gateway,
    grantsAccess,
  };
}

/** Admin subscription rows (GET /api/admin/commerce/subscriptions), batch-loaded. */
export async function presentAdminSubscriptions(
  rows: { id: string; user_id: string; plan_id: string; status: SubscriptionSummary["status"]; gateway: SubscriptionSummary["gateway"]; currency: string; amount_minor: number; interval: SubscriptionSummary["interval"]; current_period_end: Date | null; cancel_at_period_end: boolean; created_at: Date }[],
  exec: Executor = db,
): Promise<AdminSubscriptionRow[]> {
  if (!rows.length) return [];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const [users, emails, plans] = await Promise.all([
    loadSummaries(userIds, exec),
    exec.selectFrom("users").select(["id", "email"]).where("id", "in", userIds).execute(),
    exec.selectFrom("plans").select(["id", "name"]).where("id", "in", [...new Set(rows.map((r) => r.plan_id))]).execute(),
  ]);
  const emailOf = new Map(emails.map((u) => [u.id, u.email]));
  const planOf = new Map(plans.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: r.id,
    user: { ...(users.get(r.user_id) ?? { id: r.user_id, username: "deleted", displayName: "Deleted user", avatarUrl: null, headline: null, role: "LEARNER" as const }), email: emailOf.get(r.user_id) ?? "" },
    plan: { id: r.plan_id, name: planOf.get(r.plan_id) ?? "" },
    status: r.status,
    gateway: r.gateway,
    price: { amountMinor: r.amount_minor, currency: r.currency },
    interval: r.interval,
    currentPeriodEnd: r.current_period_end?.toISOString() ?? null,
    cancelAtPeriodEnd: r.cancel_at_period_end,
    createdAt: r.created_at.toISOString(),
  }));
}
