/** Pure helpers for the admin operations areas (learners, staff, certificates, audit). Tested in test/admin. */
import type { EnrollmentSource, SubscriptionStatus, UserRole, UserStatus } from "@open-lms/types";

export const ROLE_LABEL: Record<UserRole, string> = { LEARNER: "Learner", INSTRUCTOR: "Instructor", SUPPORT: "Support", FINANCE: "Finance", ADMIN: "Admin" };
export const STAFF_ROLES = ["INSTRUCTOR", "SUPPORT", "FINANCE", "ADMIN"] as const satisfies readonly UserRole[];

export const ROLE_HELP: Record<UserRole, string> = {
  LEARNER: "Takes courses. No access to the admin area.",
  INSTRUCTOR: "Builds and grades the courses they are on the team of.",
  SUPPORT: "Helps learners: access, certificates and moderation. Reads every course.",
  FINANCE: "Orders and refunds, plans, bundles and coupons.",
  ADMIN: "Everything, including settings, staff roles and the audit log.",
};

export const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: "Active",
  PENDING_VERIFICATION: "Not verified",
  SUSPENDED: "Suspended",
  BANNED: "Banned",
  DEACTIVATED: "Deactivated",
};
export const STATUS_TONE: Record<UserStatus, "success" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "success",
  PENDING_VERIFICATION: "neutral",
  SUSPENDED: "warning",
  BANNED: "danger",
  DEACTIVATED: "neutral",
};

export const SOURCE_LABEL: Record<EnrollmentSource, string> = { FREE: "Free", PURCHASE: "Purchase", BUNDLE: "Bundle", SUBSCRIPTION: "Subscription", GRANT: "Granted" };

export const SUBSCRIPTION_LABEL: Record<SubscriptionStatus, string> = {
  INCOMPLETE: "Incomplete",
  TRIALING: "Trial",
  ACTIVE: "Active",
  PAST_DUE: "Past due",
  CANCELED: "Canceled",
  EXPIRED: "Expired",
};

const RANK: Record<UserRole, number> = { LEARNER: 0, INSTRUCTOR: 1, SUPPORT: 2, FINANCE: 2, ADMIN: 3 };

/**
 * Mirrors the API rule: you act on learners, or on staff strictly below your role, never
 * on yourself. Returns why not, or null when allowed.
 */
export function protectionOf(actor: { id: string; role: UserRole }, target: { id: string; role: UserRole }): "SELF_ACTION" | "TARGET_PROTECTED" | null {
  if (actor.id === target.id) return "SELF_ACTION";
  if (target.role !== "LEARNER" && RANK[target.role] >= RANK[actor.role]) return "TARGET_PROTECTED";
  return null;
}

/** The account actions to offer for a learner's status. */
export function accountActions(status: UserStatus): { suspend: boolean; unsuspend: boolean; ban: boolean; unban: boolean } {
  return {
    suspend: status === "ACTIVE" || status === "PENDING_VERIFICATION",
    unsuspend: status === "SUSPENDED",
    ban: status !== "BANNED" && status !== "DEACTIVATED",
    unban: status === "BANNED",
  };
}

/** A date input value (YYYY-MM-DD) to the end of that local day as ISO, or null when empty. */
export function endOfDayIso(day: string): string | null {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

/** An ISO timestamp back to a date input value in local time. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** "Mar 4, 2026" */
export function shortDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(t);
}

/** "enrollment.grant" to "Enrollment grant". */
export function humanizeAction(action: string): string {
  const s = action.replace(/[._]/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Pretty JSON for the audit detail (stable key order, two-space indent). */
export function prettyJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as Record<string, unknown>).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]));
    return x;
  };
  return JSON.stringify(sort(v), null, 2);
}
