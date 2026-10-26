import { describe, expect, it } from "vitest";
import type { AdminArea, AdminSession, UserRole } from "@open-lms/types";
import { ADMIN_AREAS } from "@open-lms/types";
import { activeNavHref, areaForPath, consoleTitle, visibleNav } from "@/components/admin/shell/nav";
import { protectionOf } from "@/lib/admin-ops";
import { resolveRange } from "@/components/admin/ops/overview";

// The same table the API serves (apps/api/src/domain/admin-permissions.ts).
const AREAS: Record<Exclude<UserRole, "LEARNER">, AdminArea[]> = {
  ADMIN: [...ADMIN_AREAS],
  SUPPORT: ["overview", "courses", "learners", "grading", "orders", "certificates", "moderation"],
  FINANCE: ["overview", "orders", "plans", "coupons"],
  INSTRUCTOR: ["overview", "courses", "grading"],
};
const session = (role: Exclude<UserRole, "LEARNER">): AdminSession => ({
  role,
  permissions: Object.fromEntries(ADMIN_AREAS.map((a) => [a, AREAS[role].includes(a)])) as AdminSession["permissions"],
  allCourses: role === "ADMIN" || role === "SUPPORT",
});
const labels = (s: AdminSession) => visibleNav(s).flatMap((g) => g.items.map((i) => i.label));
const groups = (s: AdminSession) => visibleNav(s).map((g) => g.label);

describe("permission-filtered sidebar", () => {
  it("shows an admin every area, in groups", () => {
    expect(groups(session("ADMIN"))).toEqual([null, "Teaching", "Learners", "Commerce", "Academy"]);
    expect(labels(session("ADMIN"))).toEqual(["Overview", "Courses", "Categories", "Grading", "Learners", "Certificates", "Moderation", "Orders", "Plans and bundles", "Coupons", "Staff", "Settings", "Audit log"]);
  });
  it("shows an instructor only their teaching areas, without categories", () => {
    expect(labels(session("INSTRUCTOR"))).toEqual(["Overview", "Courses", "Grading"]);
    expect(groups(session("INSTRUCTOR"))).toEqual([null, "Teaching"]);
  });
  it("shows finance commerce and drops empty groups", () => {
    expect(labels(session("FINANCE"))).toEqual(["Overview", "Orders", "Plans and bundles", "Coupons"]);
    expect(groups(session("FINANCE"))).not.toContain("Academy");
  });
  it("shows support learners and orders but never settings or staff", () => {
    const l = labels(session("SUPPORT"));
    expect(l).toContain("Learners");
    expect(l).toContain("Categories");
    expect(l).not.toContain("Settings");
    expect(l).not.toContain("Staff");
    expect(l).not.toContain("Coupons");
  });
  it("titles the console Teach for instructors", () => {
    expect(consoleTitle("INSTRUCTOR")).toBe("Teach");
    expect(consoleTitle("SUPPORT")).toBe("Admin");
  });
});

describe("routing helpers", () => {
  const nav = visibleNav(session("ADMIN"));
  it("highlights the deepest matching area, and Overview only on /admin", () => {
    expect(activeNavHref("/admin", nav)).toBe("/admin");
    expect(activeNavHref("/admin/learners", nav)).toBe("/admin/learners");
    expect(activeNavHref("/admin/courses/abc/curriculum", nav)).toBe("/admin/courses");
    expect(activeNavHref("/admin/coursesx", nav)).toBeNull();
  });
  it("maps a path to the area it needs", () => {
    expect(areaForPath("/admin")).toBe("overview");
    expect(areaForPath("/admin/settings")).toBe("settings");
    expect(areaForPath("/admin/orders/123")).toBe("orders");
    expect(areaForPath("/admin/categories")).toBe("courses");
    expect(areaForPath("/admin/unknown")).toBeNull();
  });
});

describe("role limits and ranges", () => {
  it("mirrors the API protection rule", () => {
    const support = { id: "s", role: "SUPPORT" as const };
    expect(protectionOf(support, { id: "s", role: "SUPPORT" })).toBe("SELF_ACTION");
    expect(protectionOf(support, { id: "x", role: "LEARNER" })).toBeNull();
    expect(protectionOf(support, { id: "x", role: "INSTRUCTOR" })).toBeNull();
    expect(protectionOf(support, { id: "x", role: "FINANCE" })).toBe("TARGET_PROTECTED");
    expect(protectionOf({ id: "a", role: "ADMIN" }, { id: "b", role: "ADMIN" })).toBe("TARGET_PROTECTED");
  });
  it("resolves overview ranges and rejects broken custom ones", () => {
    const now = new Date(2026, 9, 26);
    expect(resolveRange("7", "", "", now)).toMatchObject({ preset: "7", from: "2026-10-20", to: "2026-10-26", error: null });
    expect(resolveRange("bogus", "", "", now)).toMatchObject({ preset: "30", from: "2026-09-27" });
    expect(resolveRange("custom", "2026-10-10", "2026-10-01", now).error).toBeTruthy();
    expect(resolveRange("custom", "2024-01-01", "2026-01-01", now).error).toMatch(/366/);
    expect(resolveRange("custom", "2026-10-01", "2026-10-10", now)).toMatchObject({ from: "2026-10-01", to: "2026-10-10", error: null });
  });
});
