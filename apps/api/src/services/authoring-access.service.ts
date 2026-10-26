/**
 * Who may do what to one course in the /admin editor. Built on access.service.ts
 * `requireCourseStaff`, which already decides visibility:
 *
 *   ADMIN       everything, on every course
 *   SUPPORT     reads every course, writes nothing (unless also on a course's staff)
 *   INSTRUCTOR  only courses they are staff on; anything else is 404 (never confirm it exists)
 *     OWNER     content, settings, prices, staff, publish, delete
 *     EDITOR    content (curriculum, questions, course text and cover)
 *     GRADER    read only (grading itself lives in admin-grading)
 *   FINANCE, LEARNER  no "courses" area: 403
 *
 * A viewer who can see the course but lacks the right gets 403 COURSE_ROLE_REQUIRED, so
 * the editor can say "ask the owner" instead of pretending the course is gone.
 */
import type { CourseStaffRole } from "@open-lms/types";
import { requireArea, type Actor } from "../core/context";
import { forbidden } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { requireCourseStaff, type CourseRef } from "./access.service";

export type CourseNeed = "read" | "edit" | "manage";

const ANY_ROLE: readonly CourseStaffRole[] = ["OWNER", "EDITOR", "GRADER"];

export async function courseRights(actor: Actor, courseId: string, need: CourseNeed, exec: Executor = db): Promise<{ course: CourseRef; role: CourseStaffRole | null }> {
  requireArea(actor, "courses");
  const found = await requireCourseStaff(actor, courseId, ANY_ROLE, { write: false }, exec);
  if (need === "read" || actor.role === "ADMIN") return found;
  if (need === "edit" && (found.role === "OWNER" || found.role === "EDITOR")) return found;
  if (need === "manage" && found.role === "OWNER") return found;
  throw forbidden(need === "manage" ? "Only the course owner can do that" : "You can view this course but not edit it", "COURSE_ROLE_REQUIRED");
}
