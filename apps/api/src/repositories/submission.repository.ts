/**
 * Assignments and their submissions. Every (re)submission is a new version; UNIQUE
 * (item_id, user_id, version) makes two concurrent submits of the same version collide
 * instead of both landing. Reviews are conditional UPDATEs on status = 'SUBMITTED'.
 */
import type { RubricCriterion } from "@open-lms/types";
import type { Insertable, Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Assignments, AssignmentSubmissions } from "../db/types";
import { atKey, newerThan, olderThan, type TimeKey } from "./keyset";

export type AssignmentRow = Selectable<Assignments>;
export type SubmissionRow = Selectable<AssignmentSubmissions>;

/** The stored rubric jsonb, keeping only well-formed criteria. */
export function rubricOf(row: Pick<AssignmentRow, "rubric">): RubricCriterion[] {
  const raw = Array.isArray(row.rubric) ? (row.rubric as unknown[]) : [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .filter((c) => typeof c.id === "string" && typeof c.title === "string" && Number.isFinite(Number(c.maxPoints)))
    .map((c) => ({ id: String(c.id), title: String(c.title), description: typeof c.description === "string" ? c.description : null, maxPoints: Number(c.maxPoints) }));
}

export interface GradingFilter {
  status: SubmissionRow["status"];
  courseIds: string[] | null;
  courseId?: string;
  cursor: TimeKey | null;
  limit: number;
}

export class SubmissionRepository {
  findAssignment(itemId: string, exec: Executor = db): Promise<AssignmentRow | undefined> {
    return exec.selectFrom("assignments").selectAll().where("item_id", "=", itemId).executeTakeFirst();
  }

  findById(id: string, exec: Executor = db): Promise<SubmissionRow | undefined> {
    return exec.selectFrom("assignment_submissions").selectAll().where("id", "=", id).executeTakeFirst();
  }

  lock(id: string, exec: Executor): Promise<SubmissionRow | undefined> {
    return exec.selectFrom("assignment_submissions").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  latest(itemId: string, userId: string, exec: Executor = db): Promise<Pick<SubmissionRow, "version" | "status"> | undefined> {
    return exec.selectFrom("assignment_submissions").select(["version", "status"]).where("item_id", "=", itemId).where("user_id", "=", userId).orderBy("version", "desc").limit(1).executeTakeFirst();
  }

  /** A learner's versions of one assignment, newest first. */
  listFor(itemId: string, userId: string, exec: Executor = db): Promise<SubmissionRow[]> {
    return exec.selectFrom("assignment_submissions").selectAll().where("item_id", "=", itemId).where("user_id", "=", userId).orderBy("version", "desc").limit(200).execute();
  }

  insert(row: Insertable<AssignmentSubmissions>, exec: Executor): Promise<SubmissionRow> {
    return exec.insertInto("assignment_submissions").values(row).returningAll().executeTakeFirstOrThrow();
  }

  async attachFiles(submissionId: string, uploadIds: readonly string[], exec: Executor): Promise<void> {
    if (!uploadIds.length) return;
    await exec
      .insertInto("submission_files")
      .values(uploadIds.map((upload_id, position) => ({ submission_id: submissionId, upload_id, position })))
      .execute();
  }

  /** Upload ids per submission, in their attached order. */
  async filesFor(submissionIds: readonly string[], exec: Executor = db): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!submissionIds.length) return out;
    const rows = await exec.selectFrom("submission_files").select(["submission_id", "upload_id"]).where("submission_id", "in", [...new Set(submissionIds)]).orderBy("submission_id").orderBy("position").execute();
    for (const r of rows) out.set(r.submission_id, [...(out.get(r.submission_id) ?? []), r.upload_id]);
    return out;
  }

  /** Record the reviewer's decision on a SUBMITTED version. Undefined when it was already reviewed. */
  review(
    id: string,
    v: { status: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED"; scores: Record<string, number>; total: number; feedback: string | null; reviewerId: string },
    exec: Executor,
  ): Promise<SubmissionRow | undefined> {
    return exec
      .updateTable("assignment_submissions")
      .set({ status: v.status, scores: JSON.stringify(v.scores), total_points: v.total, feedback: v.feedback, reviewed_by: v.reviewerId, reviewed_at: new Date() })
      .where("id", "=", id)
      .where("status", "=", "SUBMITTED")
      .returningAll()
      .executeTakeFirst();
  }

  setAiSuggestion(id: string, suggestion: Record<string, unknown>, exec: Executor = db) {
    return exec.updateTable("assignment_submissions").set({ ai_suggestion: JSON.stringify(suggestion) }).where("id", "=", id).execute();
  }

  /**
   * The grading queue. SUBMITTED reads oldest first (first in, first graded) on
   * assignment_submissions_queue_idx; reviewed statuses read newest first.
   */
  queue(f: GradingFilter, exec: Executor = db) {
    const oldestFirst = f.status === "SUBMITTED";
    let q = exec
      .selectFrom("assignment_submissions as s")
      .innerJoin("courses as c", "c.id", "s.course_id")
      .innerJoin("course_items as i", "i.id", "s.item_id")
      .innerJoin("users as u", "u.id", "s.user_id")
      .select(["s.id", "s.course_id", "s.item_id", "s.user_id", "s.version", "s.status", "s.is_late", "s.submitted_at", "c.slug as course_slug", "c.title as course_title", "i.title as item_title", "u.email as learner_email"])
      .select((eb) => eb("s.ai_suggestion", "is not", null).as("has_ai"))
      .select(atKey("s.submitted_at"))
      .where("s.status", "=", f.status);
    if (f.courseIds) q = q.where("s.course_id", "in", f.courseIds.length ? f.courseIds : ["-"]);
    if (f.courseId) q = q.where("s.course_id", "=", f.courseId);
    q = oldestFirst
      ? q.where(newerThan("s.submitted_at", "s.id", f.cursor)).orderBy("s.submitted_at", "asc").orderBy("s.id", "asc")
      : q.where(olderThan("s.submitted_at", "s.id", f.cursor)).orderBy("s.submitted_at", "desc").orderBy("s.id", "desc");
    return q.limit(f.limit + 1).execute();
  }
}

export const submissionRepo = new SubmissionRepository();
