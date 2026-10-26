import { describe, expect, it } from "vitest";
import { canSelfEnrollFree, decideAccess, subscriptionGrantsAccess, type AccessFacts } from "../../src/domain/entitlements";

const now = new Date("2026-06-15T12:00:00Z");
const day = 86_400_000;
const later = new Date(now.getTime() + 10 * day);
const earlier = new Date(now.getTime() - 10 * day);

function facts(over: Partial<AccessFacts> = {}): AccessFacts {
  return {
    course: { status: "PUBLISHED", accessMode: "PAID", includedInSubscription: true },
    viewer: { role: "LEARNER", active: true },
    staffRole: null,
    enrollment: null,
    subscription: null,
    now,
    graceDays: 3,
    ...over,
  };
}

const enrolled = (over: Partial<NonNullable<AccessFacts["enrollment"]>> = {}) => ({ source: "PURCHASE" as const, status: "ACTIVE" as const, validUntil: null, refunded: false, ...over });
const sub = (over: Partial<NonNullable<AccessFacts["subscription"]>> = {}) => ({ status: "ACTIVE" as const, currentPeriodEnd: later, trialEnd: null, ...over });

describe("decideAccess", () => {
  it("refuses signed-out visitors", () => {
    expect(decideAccess(facts({ viewer: null }))).toEqual({ granted: false, reason: "SIGNED_OUT" });
  });

  it("lets course staff in, even to a draft", () => {
    expect(decideAccess(facts({ staffRole: "GRADER", course: { status: "DRAFT", accessMode: "PAID", includedInSubscription: true } }))).toEqual({ granted: true, via: "STAFF" });
  });

  it("lets ADMIN and SUPPORT in without being on the staff, but not FINANCE or other instructors", () => {
    expect(decideAccess(facts({ viewer: { role: "ADMIN", active: true } })).granted).toBe(true);
    expect(decideAccess(facts({ viewer: { role: "SUPPORT", active: true } })).granted).toBe(true);
    expect(decideAccess(facts({ viewer: { role: "FINANCE", active: true } })).granted).toBe(false);
    expect(decideAccess(facts({ viewer: { role: "INSTRUCTOR", active: true } })).granted).toBe(false);
  });

  it("hides unpublished courses from learners, even enrolled ones", () => {
    for (const status of ["DRAFT", "ARCHIVED"] as const) {
      expect(decideAccess(facts({ course: { status, accessMode: "PAID", includedInSubscription: true }, enrollment: enrolled() }))).toEqual({ granted: false, reason: "NOT_PUBLISHED" });
    }
  });

  it("refuses inactive accounts", () => {
    expect(decideAccess(facts({ viewer: { role: "LEARNER", active: false }, enrollment: enrolled() }))).toEqual({ granted: false, reason: "INACTIVE_ACCOUNT" });
  });

  it("grants a lifetime or still-valid enrollment, and reports an expired one", () => {
    expect(decideAccess(facts({ enrollment: enrolled() }))).toEqual({ granted: true, via: "ENROLLMENT" });
    expect(decideAccess(facts({ enrollment: enrolled({ source: "GRANT", validUntil: later }) }))).toEqual({ granted: true, via: "ENROLLMENT" });
    expect(decideAccess(facts({ enrollment: enrolled({ source: "GRANT", validUntil: earlier }) }))).toEqual({ granted: false, reason: "EXPIRED" });
    expect(decideAccess(facts({ enrollment: enrolled({ source: "GRANT", validUntil: now }) }))).toEqual({ granted: false, reason: "EXPIRED" });
  });

  it("says REFUNDED or REVOKED for a revoked enrollment", () => {
    expect(decideAccess(facts({ enrollment: enrolled({ status: "REVOKED", refunded: true }) }))).toEqual({ granted: false, reason: "REFUNDED" });
    expect(decideAccess(facts({ enrollment: enrolled({ status: "REVOKED" }) }))).toEqual({ granted: false, reason: "REVOKED" });
  });

  it("re-checks SUBSCRIPTION enrollments against the subscription every time", () => {
    const e = enrolled({ source: "SUBSCRIPTION" });
    expect(decideAccess(facts({ enrollment: e, subscription: sub() }))).toEqual({ granted: true, via: "SUBSCRIPTION" });
    expect(decideAccess(facts({ enrollment: e, subscription: sub({ status: "EXPIRED" }) }))).toEqual({ granted: false, reason: "SUBSCRIPTION_ENDED" });
    expect(decideAccess(facts({ enrollment: e, subscription: null }))).toEqual({ granted: false, reason: "SUBSCRIPTION_ENDED" });
  });

  it("lets an active plan unlock included courses with no enrollment, and after a lapsed one", () => {
    expect(decideAccess(facts({ subscription: sub() }))).toEqual({ granted: true, via: "SUBSCRIPTION" });
    expect(decideAccess(facts({ subscription: sub(), enrollment: enrolled({ source: "GRANT", validUntil: earlier }) }))).toEqual({ granted: true, via: "SUBSCRIPTION" });
  });

  it("never lets a plan unlock a course excluded from it", () => {
    const course = { status: "PUBLISHED" as const, accessMode: "PAID" as const, includedInSubscription: false };
    expect(decideAccess(facts({ course, subscription: sub() }))).toEqual({ granted: false, reason: "NOT_ENROLLED" });
  });

  it("does not let a refund be undone by a lapsed plan: a refunded row with no plan stays refunded", () => {
    expect(decideAccess(facts({ enrollment: enrolled({ status: "REVOKED", refunded: true }), subscription: sub({ status: "CANCELED", currentPeriodEnd: earlier }) }))).toEqual({ granted: false, reason: "REFUNDED" });
  });

  it("does not grant FREE courses without an enrollment (enrolling is an explicit step)", () => {
    expect(decideAccess(facts({ course: { status: "PUBLISHED", accessMode: "FREE", includedInSubscription: true } }))).toEqual({ granted: false, reason: "NOT_ENROLLED" });
  });
});

describe("subscriptionGrantsAccess", () => {
  it("covers active and trialing periods that have not ended", () => {
    expect(subscriptionGrantsAccess(sub(), now, 3)).toBe(true);
    expect(subscriptionGrantsAccess(sub({ status: "TRIALING", currentPeriodEnd: null, trialEnd: later }), now, 3)).toBe(true);
    expect(subscriptionGrantsAccess(sub({ currentPeriodEnd: earlier }), now, 3)).toBe(false);
  });

  it("gives an ACTIVE subscription whose renewal event is late the same grace", () => {
    expect(subscriptionGrantsAccess(sub({ currentPeriodEnd: new Date(now.getTime() - 2 * day) }), now, 3)).toBe(true);
    expect(subscriptionGrantsAccess(sub({ currentPeriodEnd: new Date(now.getTime() - 4 * day) }), now, 3)).toBe(false);
    expect(subscriptionGrantsAccess(sub({ currentPeriodEnd: null }), now, 3)).toBe(true);
  });

  it("keeps PAST_DUE working for the grace period only", () => {
    const end = new Date(now.getTime() - 2 * day);
    expect(subscriptionGrantsAccess(sub({ status: "PAST_DUE", currentPeriodEnd: end }), now, 3)).toBe(true);
    expect(subscriptionGrantsAccess(sub({ status: "PAST_DUE", currentPeriodEnd: end }), now, 1)).toBe(false);
  });

  it("honours the paid-for remainder of a cancelled subscription, then stops", () => {
    expect(subscriptionGrantsAccess(sub({ status: "CANCELED", currentPeriodEnd: later }), now, 3)).toBe(true);
    expect(subscriptionGrantsAccess(sub({ status: "CANCELED", currentPeriodEnd: earlier }), now, 3)).toBe(false);
  });

  it("never grants INCOMPLETE or EXPIRED", () => {
    expect(subscriptionGrantsAccess(sub({ status: "INCOMPLETE" }), now, 3)).toBe(false);
    expect(subscriptionGrantsAccess(sub({ status: "EXPIRED" }), now, 3)).toBe(false);
  });
});

describe("canSelfEnrollFree", () => {
  it("is only for signed-in, active viewers on published FREE courses", () => {
    const free = { status: "PUBLISHED" as const, accessMode: "FREE" as const, includedInSubscription: true };
    expect(canSelfEnrollFree({ course: free, viewer: { role: "LEARNER", active: true } })).toBe(true);
    expect(canSelfEnrollFree({ course: { ...free, accessMode: "PAID" }, viewer: { role: "LEARNER", active: true } })).toBe(false);
    expect(canSelfEnrollFree({ course: { ...free, status: "DRAFT" }, viewer: { role: "LEARNER", active: true } })).toBe(false);
    expect(canSelfEnrollFree({ course: free, viewer: null })).toBe(false);
    expect(canSelfEnrollFree({ course: free, viewer: { role: "LEARNER", active: false } })).toBe(false);
  });
});
