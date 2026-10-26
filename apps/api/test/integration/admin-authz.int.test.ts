/**
 * The role sweep over every operations route (admin.routes.ts): signed out is 401,
 * learners are 403 everywhere, instructors only reach the overview (their courses), FINANCE
 * only the overview, SUPPORT learners and certificates, ADMIN everything. Calls use
 * valid bodies aimed at ids that do not exist, so an allowed call is a 200 or a 404 and
 * a refused one is 403 FORBIDDEN_AREA; nothing changes either way.
 */
import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { as, createUser, type Role, type TestUser } from "./harness";
import { operator } from "./ops-fixtures";

type Area = "operator" | "overview" | "learners" | "erase" | "certificates" | "staff" | "settings" | "audit";

const ghost = newId();
const ROUTES: { method: "get" | "post" | "patch"; path: string; body?: unknown; area: Area }[] = [
  { method: "get", path: "/api/admin/me", area: "operator" },
  { method: "get", path: "/api/admin/stats", area: "overview" },
  { method: "get", path: "/api/admin/stats.csv", area: "overview" },
  { method: "get", path: "/api/admin/learners", area: "learners" },
  { method: "get", path: `/api/admin/learners/${ghost}`, area: "learners" },
  { method: "post", path: `/api/admin/learners/${ghost}/enrollments`, body: { courseId: ghost }, area: "learners" },
  { method: "post", path: `/api/admin/learners/${ghost}/suspend`, body: { days: 1, reason: "Sweep" }, area: "learners" },
  { method: "post", path: `/api/admin/learners/${ghost}/unsuspend`, area: "learners" },
  { method: "post", path: `/api/admin/learners/${ghost}/ban`, body: { reason: "Sweep" }, area: "learners" },
  { method: "post", path: `/api/admin/learners/${ghost}/unban`, area: "learners" },
  { method: "post", path: `/api/admin/learners/${ghost}/erase`, body: { reason: "Sweep" }, area: "erase" },
  { method: "post", path: `/api/admin/enrollments/${ghost}/revoke`, body: { reason: "Sweep" }, area: "learners" },
  { method: "patch", path: `/api/admin/enrollments/${ghost}`, body: { validUntil: null }, area: "learners" },
  { method: "get", path: "/api/admin/certificates", area: "certificates" },
  { method: "post", path: `/api/admin/certificates/${ghost}/revoke`, body: { reason: "Sweep" }, area: "certificates" },
  { method: "post", path: `/api/admin/certificates/${ghost}/restore`, area: "certificates" },
  { method: "get", path: "/api/admin/staff", area: "staff" },
  { method: "patch", path: `/api/admin/staff/${ghost}`, body: { role: "SUPPORT" }, area: "staff" },
  { method: "get", path: "/api/admin/settings", area: "settings" },
  { method: "patch", path: "/api/admin/settings", body: {}, area: "settings" },
  { method: "get", path: "/api/admin/integrations", area: "settings" },
  { method: "post", path: "/api/admin/integrations/evs/test", area: "settings" },
  { method: "get", path: "/api/admin/audit", area: "audit" },
];

const ALLOWED: Record<Role, Area[]> = {
  LEARNER: [],
  INSTRUCTOR: ["operator", "overview"],
  FINANCE: ["operator", "overview"],
  SUPPORT: ["operator", "overview", "learners", "certificates"],
  ADMIN: ["operator", "overview", "learners", "erase", "certificates", "staff", "settings", "audit"],
};

function call(user: TestUser | null, r: (typeof ROUTES)[number]) {
  const req = as(user)[r.method](r.path);
  return r.body === undefined ? req : req.send(r.body as object);
}

describe("every operations route checks the area", () => {
  test("signed out: 401 everywhere", async () => {
    for (const r of ROUTES) expect((await call(null, r)).status, `${r.method} ${r.path}`).toBe(401);
  });

  for (const role of ["LEARNER", "INSTRUCTOR", "FINANCE", "SUPPORT", "ADMIN"] as const) {
    test(`${role}`, async () => {
      const user = role === "LEARNER" ? await createUser() : await operator(role);
      for (const r of ROUTES) {
        const res = await call(user, r);
        const label = `${role} ${r.method.toUpperCase()} ${r.path}`;
        if (ALLOWED[role].includes(r.area)) {
          expect([200, 404], `${label}: ${JSON.stringify(res.body)}`).toContain(res.status);
        } else {
          expect(res.status, label).toBe(403);
          expect(res.body.code, label).toBe("FORBIDDEN_AREA");
        }
      }
    });
  }
});
