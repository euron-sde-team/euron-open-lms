import { ADMIN_AREAS, type AdminArea, type UserRole } from "@open-lms/types";
import { describe, expect, it } from "vitest";
import { canOpenArea, canRefund, isOperator, permissionsFor, seesAllCourses } from "../../src/domain/admin-permissions";

describe("admin areas by role", () => {
  it("lets ADMIN open every area", () => {
    for (const a of ADMIN_AREAS) expect(canOpenArea("ADMIN", a)).toBe(true);
  });

  it("keeps learners out of /admin entirely", () => {
    for (const a of ADMIN_AREAS) expect(canOpenArea("LEARNER", a)).toBe(false);
    expect(isOperator("LEARNER")).toBe(false);
  });

  const only: Record<Exclude<UserRole, "ADMIN" | "LEARNER">, AdminArea[]> = {
    INSTRUCTOR: ["overview", "courses", "grading"],
    SUPPORT: ["overview", "courses", "learners", "grading", "orders", "certificates", "moderation"],
    FINANCE: ["overview", "orders", "plans", "coupons"],
  };
  for (const [role, areas] of Object.entries(only) as [keyof typeof only, AdminArea[]][]) {
    it(`${role} opens exactly ${areas.join(", ")}`, () => {
      expect(ADMIN_AREAS.filter((a) => canOpenArea(role, a))).toEqual(areas);
    });
  }

  it("never lets anyone but ADMIN reach settings, staff or the audit log", () => {
    for (const role of ["INSTRUCTOR", "SUPPORT", "FINANCE"] as const) {
      for (const a of ["settings", "staff", "audit"] as const) expect(canOpenArea(role, a)).toBe(false);
    }
  });

  it("builds the permission map the web app hides its sidebar with", () => {
    const p = permissionsFor("FINANCE");
    expect(Object.keys(p).sort()).toEqual([...ADMIN_AREAS].sort());
    expect(p.orders).toBe(true);
    expect(p.courses).toBe(false);
  });

  it("only ADMIN and SUPPORT see every course; only ADMIN and FINANCE refund", () => {
    expect(["ADMIN", "SUPPORT", "FINANCE", "INSTRUCTOR"].filter((r) => seesAllCourses(r as UserRole))).toEqual(["ADMIN", "SUPPORT"]);
    expect(["ADMIN", "SUPPORT", "FINANCE", "INSTRUCTOR"].filter((r) => canRefund(r as UserRole))).toEqual(["ADMIN", "FINANCE"]);
  });
});
