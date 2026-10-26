/**
 * Who may open a course's content. The single source of truth: every content route
 * (curriculum, playback, progress, quizzes, assignments, notes, Q&A, reviews,
 * certificates) goes through services/access.service.ts, which loads the facts below and
 * asks `decideAccess`. Nothing else in the codebase reads enrollments to decide access.
 *
 * Pure: no I/O, so every rule is a unit test (test/unit/entitlements.test.ts).
 */
import type { AccessMode, CourseStatus, EnrollmentSource, SubscriptionStatus, UserRole } from "@open-lms/types";

export interface AccessFacts {
  course: { status: CourseStatus; accessMode: AccessMode; includedInSubscription: boolean };
  viewer: { role: UserRole; active: boolean } | null;
  /** The viewer's role on this course's staff, if any. */
  staffRole: "OWNER" | "EDITOR" | "GRADER" | null;
  enrollment: { source: EnrollmentSource; status: "ACTIVE" | "REVOKED"; validUntil: Date | null; refunded: boolean } | null;
  subscription: { status: SubscriptionStatus; currentPeriodEnd: Date | null; trialEnd: Date | null } | null;
  now: Date;
  /** Days a PAST_DUE subscription keeps unlocking courses (settings.learning.subscriptionGraceDays). */
  graceDays: number;
}

export type AccessDecision =
  | { granted: true; via: "STAFF" | "ENROLLMENT" | "SUBSCRIPTION" }
  | { granted: false; reason: "SIGNED_OUT" | "INACTIVE_ACCOUNT" | "NOT_PUBLISHED" | "NOT_ENROLLED" | "EXPIRED" | "REVOKED" | "REFUNDED" | "SUBSCRIPTION_ENDED" };

/** Platform roles that see every course's content without being on its staff. */
const SEE_ALL: readonly UserRole[] = ["ADMIN", "SUPPORT"];

/**
 * A subscription unlocks courses while it is trialing or active and the period has not
 * ended, and for `graceDays` after a failed renewal (PAST_DUE) so a card hiccup does
 * not lock a learner out mid-lesson. TRIALING and ACTIVE past their period end get the
 * same grace: that usually means the renewal event has not arrived yet, and the
 * billing.expire-subscriptions job asks the gateway before ending anything. CANCELED
 * with time left in the paid period still counts: cancelling stops the renewal, not the
 * period already paid for.
 */
export function subscriptionGrantsAccess(sub: AccessFacts["subscription"], now: Date, graceDays: number): boolean {
  if (!sub) return false;
  const end = sub.currentPeriodEnd ?? sub.trialEnd;
  switch (sub.status) {
    case "TRIALING":
    case "ACTIVE":
      // No period reported yet (the first payment's event is in flight): live.
      return !end || end.getTime() + graceDays * 86_400_000 > now.getTime();
    case "PAST_DUE":
      return !!end && end.getTime() + graceDays * 86_400_000 > now.getTime();
    case "CANCELED":
      return !!end && end > now;
    default:
      return false;
  }
}

/**
 * The order of the checks is the policy:
 *   1. staff (and see-all roles) always get in, even to drafts, so they can author;
 *   2. learners need the course published, and an active account;
 *   3. an enrollment grants access by its source: SUBSCRIPTION rows only while the
 *      subscription does, every other source until valid_until (NULL = for life),
 *      unless revoked or its order was refunded;
 *   4. with no usable enrollment, an active plan still unlocks included courses (the
 *      enrollment row is created on first open, for progress).
 * A lapsed enrollment reports why, so the course page can say "Your access expired".
 */
export function decideAccess(f: AccessFacts): AccessDecision {
  if (!f.viewer) return { granted: false, reason: "SIGNED_OUT" };
  if (f.staffRole || SEE_ALL.includes(f.viewer.role)) return { granted: true, via: "STAFF" };
  if (!f.viewer.active) return { granted: false, reason: "INACTIVE_ACCOUNT" };
  if (f.course.status !== "PUBLISHED") return { granted: false, reason: "NOT_PUBLISHED" };

  const planUnlocks = f.course.includedInSubscription && subscriptionGrantsAccess(f.subscription, f.now, f.graceDays);
  let lapsed: AccessDecision | null = null;

  const e = f.enrollment;
  if (e) {
    if (e.status === "REVOKED") lapsed = { granted: false, reason: e.refunded ? "REFUNDED" : "REVOKED" };
    else if (e.source === "SUBSCRIPTION") {
      if (planUnlocks) return { granted: true, via: "SUBSCRIPTION" };
      lapsed = { granted: false, reason: "SUBSCRIPTION_ENDED" };
    } else if (e.validUntil && e.validUntil <= f.now) lapsed = { granted: false, reason: "EXPIRED" };
    else return { granted: true, via: "ENROLLMENT" };
  }

  if (planUnlocks) return { granted: true, via: "SUBSCRIPTION" };
  return lapsed ?? { granted: false, reason: "NOT_ENROLLED" };
}

/** May this viewer enroll in a FREE course with one click? */
export function canSelfEnrollFree(f: Pick<AccessFacts, "course" | "viewer">): boolean {
  return !!f.viewer && f.viewer.active && f.course.status === "PUBLISHED" && f.course.accessMode === "FREE";
}
