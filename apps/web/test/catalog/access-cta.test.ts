import { describe, expect, it } from "vitest";
import type { CourseAccess } from "@open-lms/types";
import { accessCta, courseIncludes, checkoutHref, learnHref } from "@/lib/course-access";
import { formatDuration } from "@/lib/duration";

const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const course = (access: CourseAccess) => ({ id: "01HCOURSE", slug: "intro-sql", access });

describe("accessCta", () => {
  it("ENROLLED continues at the resume item", () => {
    const c = accessCta(course({ state: "ENROLLED", enrollmentId: "e", progressPercent: 40, completedAt: null, validUntil: null, resumeItemId: "01ITEM" }));
    expect(c.primary).toMatchObject({ kind: "link", href: "/learn/intro-sql/01ITEM", label: "Continue learning" });
    expect(c.hasAccess).toBe(true);
    expect(c.price).toBeNull();
  });

  it("ENROLLED without progress or a resume item starts at the classroom", () => {
    const c = accessCta(course({ state: "ENROLLED", enrollmentId: "e", progressPercent: 0, completedAt: null, validUntil: null, resumeItemId: null }));
    expect(c.primary).toMatchObject({ href: "/learn/intro-sql", label: "Start learning" });
  });

  it("ENROLLED and completed says so", () => {
    const c = accessCta(course({ state: "ENROLLED", enrollmentId: "e", progressPercent: 100, completedAt: "2026-01-01T00:00:00Z", validUntil: null, resumeItemId: null }));
    expect(c.note).toMatch(/completed/);
    expect(c.primary?.label).toBe("Continue learning");
  });

  it("FREE enrolls in one click", () => {
    const c = accessCta(course({ state: "FREE" }));
    expect(c.primary).toMatchObject({ kind: "enroll", label: "Enroll for free" });
  });

  it("INCLUDED_IN_PLAN starts in the classroom", () => {
    const c = accessCta(course({ state: "INCLUDED_IN_PLAN" }));
    expect(c.primary).toMatchObject({ kind: "link", href: "/learn/intro-sql", label: "Start learning" });
    expect(c.note).toMatch(/plan/);
  });

  it("PURCHASABLE goes to checkout in the price's currency, with the plan link when a plan covers it", () => {
    const c = accessCta(course({ state: "PURCHASABLE", price: usd(4900), compareAt: usd(9900), subscriptionAlso: true }), { currency: "EUR" });
    expect(c.primary?.kind).toBe("link");
    expect(c.primary && "href" in c.primary ? c.primary.href : "").toBe("/checkout?type=COURSE&id=01HCOURSE&currency=USD");
    expect(c.primary?.label).toMatch(/^Buy now · \$49/);
    expect(c.secondary).toEqual({ label: "or get it with a plan", href: "/plans" });
    expect(c.price).toEqual(usd(4900));
    expect(c.compareAt).toEqual(usd(9900));
  });

  it("PURCHASABLE without a plan has no plan link", () => {
    expect(accessCta(course({ state: "PURCHASABLE", price: usd(100), compareAt: null, subscriptionAlso: false })).secondary).toBeNull();
  });

  it("SUBSCRIPTION_REQUIRED sends to plans", () => {
    expect(accessCta(course({ state: "SUBSCRIPTION_REQUIRED" })).primary).toMatchObject({ href: "/plans", label: "See plans" });
  });

  it.each(["EXPIRED", "REVOKED", "REFUNDED"] as const)("LAPSED %s with a price explains and offers to buy again", (reason) => {
    const c = accessCta(course({ state: "LAPSED", reason, price: usd(2500) }));
    expect(c.note).toBeTruthy();
    expect(c.primary?.label).toMatch(/^Buy again/);
    expect(c.primary && "href" in c.primary ? c.primary.href : "").toContain("type=COURSE");
  });

  it("LAPSED after a plan ended without a price points at plans", () => {
    const c = accessCta(course({ state: "LAPSED", reason: "SUBSCRIPTION_ENDED", price: null }));
    expect(c.note).toMatch(/plan has ended/);
    expect(c.primary).toMatchObject({ href: "/plans" });
  });

  it("LAPSED with no way back shows only the reason", () => {
    const c = accessCta(course({ state: "LAPSED", reason: "REVOKED", price: null }));
    expect(c.primary).toBeNull();
    expect(c.note).toMatch(/removed/);
  });

  it("UNAVAILABLE has no button", () => {
    const c = accessCta(course({ state: "UNAVAILABLE" }));
    expect(c.primary).toBeNull();
    expect(c.note).toMatch(/not on sale/);
  });

  it("STAFF opens the classroom as a preview", () => {
    const c = accessCta(course({ state: "STAFF" }));
    expect(c.primary).toMatchObject({ href: "/learn/intro-sql", label: "Open classroom (staff preview)" });
    expect(c.hasAccess).toBe(true);
  });

  it("SIGNED_OUT signs in and comes back", () => {
    const free = accessCta(course({ state: "SIGNED_OUT", free: true, price: null }));
    expect(free.primary).toMatchObject({ href: "/login?next=%2Fcourses%2Fintro-sql", label: "Sign in to enroll for free" });
    expect(free.secondary?.href).toBe("/signup?next=%2Fcourses%2Fintro-sql");
    const paid = accessCta(course({ state: "SIGNED_OUT", free: false, price: usd(900) }));
    expect(paid.price).toEqual(usd(900));
    expect(paid.primary?.label).toBe("Sign in to get this course");
  });
});

describe("hrefs and includes", () => {
  it("encodes classroom and checkout links", () => {
    expect(learnHref("a b", "x/y")).toBe("/learn/a%20b/x%2Fy");
    expect(checkoutHref("BUNDLE", "01B")).toBe("/checkout?type=BUNDLE&id=01B");
  });

  it("lists only real counts", () => {
    const lines = courseIncludes({ counts: { lectures: 12, quizzes: 1, assignments: 2, articles: 0, pdfs: 1 }, durationSeconds: 3 * 3600, certificateEnabled: true }, formatDuration);
    expect(lines).toEqual(["12 video lessons, 3 h in all", "1 PDF to read or download", "1 quiz", "2 projects reviewed by instructors", "A certificate when you finish"]);
    expect(courseIncludes({ counts: { lectures: 0, quizzes: 0, assignments: 0, articles: 0, pdfs: 0 }, durationSeconds: 0, certificateEnabled: false }, formatDuration)).toEqual([]);
  });
});
