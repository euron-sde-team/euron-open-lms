/**
 * DTOs of the learners console: AdminUserRow (batch-loaded per page), AdminEnrollment
 * (with `grantsAccess` decided by domain/entitlements.ts, the same rule every content
 * route uses), the AdminOrderRow lines of a learner's recent orders and their offline
 * download licences (AdminDownloadRow).
 */
import type { AdminDownloadRow, AdminEnrollment, AdminOrderRow, AdminUserRow, UserStatus, UserSummary } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { decideAccess } from "../domain/entitlements";
import { adminLearnersRepo } from "../repositories/admin-learners.repository";
import { subscriptionFacts } from "../services/access.service";
import { getSettings } from "../services/settings.service";
import { loadSummaries } from "./user.presenter";

type AccountRow = Awaited<ReturnType<typeof adminLearnersRepo.accounts>>[number];
type EnrollmentRow = Awaited<ReturnType<typeof adminLearnersRepo.enrollments>>[number];
type OrderRow = Awaited<ReturnType<typeof adminLearnersRepo.recentOrders>>[number];

export function toUserRow(summary: UserSummary, row: AccountRow, enrollmentCount: number, spent: { amountMinor: number; currency: string }[]): AdminUserRow {
  return {
    ...summary,
    email: String(row.email),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    suspendedUntil: row.status === "SUSPENDED" && row.suspended_until ? row.suspended_until.toISOString() : null,
    enrollmentCount,
    totalSpent: spent,
  };
}

/** AdminUserRow for each id, in the order given (unknown ids are dropped). */
export async function adminUserRows(ids: readonly string[], exec: Executor = db): Promise<AdminUserRow[]> {
  if (!ids.length) return [];
  const [accounts, summaries, counts, spent] = await Promise.all([
    adminLearnersRepo.accounts(ids, exec),
    loadSummaries(ids, exec),
    adminLearnersRepo.enrollmentCounts(ids, exec),
    adminLearnersRepo.spent(ids, exec),
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    const summary = summaries.get(id);
    return row && summary ? [toUserRow(summary, row, counts.get(id) ?? 0, spent.get(id) ?? [])] : [];
  });
}

/**
 * Enrollment rows of ONE learner to DTOs. `grantsAccess` is what that learner would be
 * told right now if they opened the course: a revoked row still "grants" while their
 * plan unlocks the course, an expired grant does not.
 */
export async function presentEnrollments(rows: readonly EnrollmentRow[], learner: { id: string; status: UserStatus }, exec: Executor = db): Promise<AdminEnrollment[]> {
  if (!rows.length) return [];
  const [sub, settings, granters] = await Promise.all([subscriptionFacts(learner.id, exec), getSettings(exec), loadSummaries(rows.map((r) => r.granted_by), exec)]);
  const now = new Date();
  const subscription = sub ? { status: sub.status, currentPeriodEnd: sub.current_period_end, trialEnd: sub.trial_end } : null;
  return rows.map((r) => {
    const decision = decideAccess({
      course: { status: r.course_status, accessMode: r.access_mode, includedInSubscription: r.included_in_subscription },
      // The learner's own entitlement, not whatever staff role they may also hold.
      viewer: { role: "LEARNER", active: learner.status === "ACTIVE" || learner.status === "SUSPENDED" },
      staffRole: null,
      enrollment: { source: r.source, status: r.status, validUntil: r.valid_until, refunded: r.order_status === "REFUNDED" },
      subscription,
      now,
      graceDays: settings.learning.subscriptionGraceDays,
    });
    return {
      id: r.id,
      course: { id: r.course_id, slug: String(r.slug), title: r.title },
      source: r.source,
      status: r.status,
      grantsAccess: decision.granted,
      progressPercent: r.progress_percent,
      completedAt: r.completed_at?.toISOString() ?? null,
      validUntil: r.valid_until?.toISOString() ?? null,
      grantedBy: r.granted_by ? (granters.get(r.granted_by) ?? null) : null,
      grantNote: r.grant_note,
      orderNumber: r.order_number,
      createdAt: r.created_at.toISOString(),
      revokedAt: r.revoked_at?.toISOString() ?? null,
      revokedReason: r.revoked_reason,
    };
  });
}

/** One enrollment by id, presented; null when it does not exist. */
export async function enrollmentById(id: string, exec: Executor = db): Promise<AdminEnrollment | null> {
  const [row] = await adminLearnersRepo.enrollments({ id }, exec);
  if (!row) return null;
  const learner = await exec.selectFrom("users").select(["id", "status"]).where("id", "=", row.user_id).executeTakeFirstOrThrow();
  return (await presentEnrollments([row], learner, exec))[0] ?? null;
}

export function presentOrderRows(rows: readonly OrderRow[], user: UserSummary & { email: string }): AdminOrderRow[] {
  return rows.map((o) => {
    const lines = Number(o.line_count ?? 0);
    const title = o.first_title ? (lines > 1 ? `${o.first_title} and ${lines - 1} more` : o.first_title) : o.number;
    return {
      id: o.id,
      number: o.number,
      kind: o.kind,
      status: o.status,
      gateway: o.gateway,
      user,
      title,
      total: { amountMinor: o.total_minor, currency: o.currency.trim() },
      refunded: { amountMinor: o.refunded_minor, currency: o.currency.trim() },
      couponCode: o.coupon_code ? String(o.coupon_code) : null,
      createdAt: o.created_at.toISOString(),
      paidAt: o.paid_at?.toISOString() ?? null,
    };
  });
}

/** One offline download licence on the learner's page. */
export function presentDownload(r: { id: string; item_id: string; item_title: string; course_id: string; course_slug: string; course_title: string; device_id: string; created_at: Date; expires_at: Date; revoked_at: Date | null }, now = new Date()): AdminDownloadRow {
  return {
    id: r.id,
    item: { id: r.item_id, title: r.item_title },
    course: { id: r.course_id, slug: String(r.course_slug), title: r.course_title },
    deviceId: r.device_id,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at.toISOString(),
    revokedAt: r.revoked_at?.toISOString() ?? null,
    active: !r.revoked_at && r.expires_at > now,
  };
}
