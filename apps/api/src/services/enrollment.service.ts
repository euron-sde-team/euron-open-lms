/**
 * Creating and ending enrollments. Every path that gives or takes access goes through
 * here so the counters, the audit trail and the notification are never forgotten:
 *   - checkout fulfilment (PURCHASE, BUNDLE)          services/payments/fulfilment.service.ts
 *   - one-click free enrollment (FREE)                services/catalog.service.ts
 *   - admin grants and revokes (GRANT)                services/admin-learners.service.ts
 *   - subscription access (SUBSCRIPTION)              services/access.service.ts (on first open)
 *
 * Granting is an upsert on (user_id, course_id): enrolling again keeps the learner's
 * progress and re-activates a revoked row. A grant never shortens access: an existing
 * lifetime enrollment stays lifetime, and the later `valid_until` wins.
 */
import type { EnrollmentSource } from "@open-lms/types";
import { sql } from "kysely";
import type { Effects } from "../core/effects";
import { newId } from "../core/ids";
import type { Executor } from "../db/kysely";
import { audit } from "./audit.service";
import { notify } from "./notification.service";

export interface GrantInput {
  userId: string;
  courseId: string;
  source: EnrollmentSource;
  orderId?: string | null;
  bundleId?: string | null;
  grantedBy?: string | null;
  note?: string | null;
  validUntil?: Date | null;
  /** Notify the learner (admin grants do; purchases send a receipt instead). */
  notifyLearner?: boolean;
}

/** Returns the enrollment id and whether it newly granted access (for counters and messages). */
export async function grantEnrollment(input: GrantInput, trx: Executor, fx: Effects): Promise<{ id: string; created: boolean; reactivated: boolean }> {
  const existing = await trx.selectFrom("enrollments").select(["id", "status", "valid_until", "source"]).where("user_id", "=", input.userId).where("course_id", "=", input.courseId).forUpdate().executeTakeFirst();
  const now = new Date();
  if (!existing) {
    const id = newId();
    await trx
      .insertInto("enrollments")
      .values({
        id,
        user_id: input.userId,
        course_id: input.courseId,
        source: input.source,
        order_id: input.orderId ?? null,
        bundle_id: input.bundleId ?? null,
        granted_by: input.grantedBy ?? null,
        grant_note: input.note ?? null,
        valid_until: input.validUntil ?? null,
        last_activity_at: now,
      })
      .execute();
    await trx.updateTable("courses").set((eb) => ({ enrollment_count: eb("enrollment_count", "+", 1) })).where("id", "=", input.courseId).execute();
    await after(input, id, trx, fx);
    return { id, created: true, reactivated: false };
  }
  // Never shorten: a live lifetime enrollment stays lifetime (and keeps its source, so a
  // grant on top of a purchase still reads as the purchase); otherwise the later end
  // date wins, and no end date means lifetime. A SUBSCRIPTION row bought outright
  // becomes the purchase.
  const lifetime = existing.status === "ACTIVE" && existing.source !== "SUBSCRIPTION" && existing.valid_until === null;
  const wanted = input.validUntil ?? null;
  const stillValid = existing.status === "ACTIVE" && existing.source !== "SUBSCRIPTION" ? existing.valid_until : null;
  const nextValid = lifetime || wanted === null ? null : stillValid && stillValid > wanted ? stillValid : wanted;
  const nextSource = lifetime && input.source === "GRANT" ? existing.source : input.source;
  const reactivated = existing.status === "REVOKED";
  await trx
    .updateTable("enrollments")
    .set({
      source: nextSource,
      status: "ACTIVE",
      order_id: input.orderId ?? sql`order_id`,
      bundle_id: input.bundleId ?? sql`bundle_id`,
      granted_by: input.grantedBy ?? sql`granted_by`,
      grant_note: input.note ?? sql`grant_note`,
      valid_until: nextValid,
      revoked_at: null,
      revoked_reason: null,
      updated_at: now,
    })
    .where("id", "=", existing.id)
    .execute();
  await after(input, existing.id, trx, fx);
  return { id: existing.id, created: false, reactivated };
}

async function after(input: GrantInput, enrollmentId: string, trx: Executor, fx: Effects): Promise<void> {
  if (input.source === "GRANT") {
    await audit({ actorId: input.grantedBy ?? null, action: "enrollment.grant", entityType: "enrollment", entityId: enrollmentId, data: { userId: input.userId, courseId: input.courseId, validUntil: input.validUntil?.toISOString() ?? null, note: input.note ?? null } }, trx);
  }
  if (input.notifyLearner) {
    const course = await trx.selectFrom("courses").select(["slug", "title"]).where("id", "=", input.courseId).executeTakeFirstOrThrow();
    await notify({ recipientId: input.userId, actorId: input.grantedBy ?? null, type: "ENROLLMENT_GRANTED", entityType: "course", entityId: input.courseId, snippet: course.title, data: { courseSlug: String(course.slug) } }, fx, trx);
  }
}

/** End access but keep the row (and the learner's progress) for history and re-enrollment. */
export async function revokeEnrollment(input: { enrollmentId: string; reason: string; actorId: string | null; notifyLearner?: boolean }, trx: Executor, fx: Effects): Promise<boolean> {
  const row = await trx
    .updateTable("enrollments")
    .set({ status: "REVOKED", revoked_at: new Date(), revoked_reason: input.reason.slice(0, 300), updated_at: new Date() })
    .where("id", "=", input.enrollmentId)
    .where("status", "=", "ACTIVE")
    .returning(["id", "user_id", "course_id"])
    .executeTakeFirst();
  if (!row) return false;
  await audit({ actorId: input.actorId, action: "enrollment.revoke", entityType: "enrollment", entityId: row.id, data: { userId: row.user_id, courseId: row.course_id, reason: input.reason } }, trx);
  if (input.notifyLearner) {
    const course = await trx.selectFrom("courses").select(["slug", "title"]).where("id", "=", row.course_id).executeTakeFirstOrThrow();
    await notify({ recipientId: row.user_id, actorId: input.actorId, type: "ENROLLMENT_REVOKED", entityType: "course", entityId: row.course_id, snippet: course.title, data: { courseSlug: String(course.slug) } }, fx, trx);
  }
  return true;
}
