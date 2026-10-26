/**
 * Which /admin areas each platform role can open. One table, used by the API (every
 * admin route calls requireArea) and sent to the web app so the sidebar shows only what
 * the operator may use.
 *
 *   ADMIN       everything, including settings, staff roles and the audit log
 *   SUPPORT     learners and their enrollments, certificates and moderation; every course (read)
 *   FINANCE     orders and refunds, plans and bundles, coupons
 *   INSTRUCTOR  the courses they are on the staff of, and grading for them
 *
 * Course-level rights (OWNER / EDITOR / GRADER) are checked separately by
 * services/access.service.ts (requireCourseStaff): an instructor in the "courses" area still only
 * sees and edits their own courses.
 */
import type { AdminArea, AdminPermissions, UserRole } from "@open-lms/types";
import { ADMIN_AREAS } from "@open-lms/types";

const AREAS: Record<Exclude<UserRole, "LEARNER">, readonly AdminArea[]> = {
  ADMIN: ADMIN_AREAS,
  SUPPORT: ["overview", "courses", "learners", "grading", "orders", "certificates", "moderation"],
  FINANCE: ["overview", "orders", "plans", "coupons"],
  INSTRUCTOR: ["overview", "courses", "grading"],
};

export const ALL_AREAS: readonly AdminArea[] = ADMIN_AREAS;

export function canOpenArea(role: UserRole, area: AdminArea): boolean {
  return role !== "LEARNER" && AREAS[role].includes(area);
}

export function permissionsFor(role: UserRole): AdminPermissions {
  return Object.fromEntries(ALL_AREAS.map((a) => [a, canOpenArea(role, a)])) as AdminPermissions;
}

/** Any staff role at all (or an instructor): may open /admin. */
export function isOperator(role: UserRole): boolean {
  return role !== "LEARNER";
}

/** Roles that see every course, not only the ones they are on the staff of. */
export function seesAllCourses(role: UserRole): boolean {
  return role === "ADMIN" || role === "SUPPORT";
}

/** Read-only access to orders: SUPPORT may look an order up, only FINANCE and ADMIN refund. */
export function canRefund(role: UserRole): boolean {
  return role === "ADMIN" || role === "FINANCE";
}
