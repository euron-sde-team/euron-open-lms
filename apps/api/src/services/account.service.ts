/**
 * Account lifecycle: deleting your own account (with a grace period), an admin erasing
 * one, and exporting your own data.
 *
 * Delete (DELETE /api/users/me) marks the account `deletion_requested_at` and signs it
 * out everywhere. Signing in again within the grace period cancels the request; after
 * it, the maintenance.purge-accounts job runs `anonymiseUser`. An admin erase (POST
 * /api/admin/learners/:id/erase) runs it at once.
 *
 * `anonymiseUser` keeps the users row, because orders, invoices and enrollments
 * reference it (financial records are kept, as the law usually requires), but
 * everything that identifies the person goes:
 *   - users: status DEACTIVATED, email deleted+<id>@invalid.example, username
 *     deleted-<id tail>, display and certificate names "Deleted user", bio, website and
 *     avatar cleared, two-factor removed, password replaced with an unknown one, every
 *     session revoked and token_version bumped;
 *   - learning traces: notes, bookmarks, saved courses, quiz answers and submission text
 *     and files are deleted; certificates are deleted (they carry the name);
 *   - devices: push registrations and offline download licences are deleted (a pending
 *     deletion already drops the push registrations, so a signed-out phone goes quiet);
 *   - reviews and Q&A stay, shown under "Deleted user" so threads keep their shape.
 * A live subscription blocks deletion (409 SUBSCRIPTION_ACTIVE: cancel it first, so the
 * gateway stops charging), and so does being the last active admin (409 LAST_ADMIN).
 *
 * Export (GET /api/users/me/export) streams one JSON document of the caller's own data,
 * read in pages of EXPORT_PAGE rows so a large account never sits in memory at once.
 */
import type { Response } from "express";
import type { Actor, RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { toMe } from "../presenters/user.presenter";
import { recoveryCodeRepo } from "../repositories/recovery-code.repository";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo } from "../repositories/user.repository";
import { hashPassword } from "../security/passwords";
import { randomToken } from "../security/tokens";
import { audit } from "./audit.service";
import { confirmIdentity } from "./auth.service";

export const DELETED_DISPLAY_NAME = "Deleted user";
/** Days between asking to delete an account and the purge. */
export const DELETION_GRACE_DAYS = 14;

async function assertCanLeave(userId: string, role: string): Promise<void> {
  const live = await db.selectFrom("subscriptions").select("id").where("user_id", "=", userId).where("status", "in", ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE"]).where("cancel_at_period_end", "=", false).executeTakeFirst();
  if (live) throw conflict("Cancel your subscription before deleting your account", "SUBSCRIPTION_ACTIVE");
  if (role === "ADMIN") {
    const others = await db.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", userId).executeTakeFirst();
    if (!others) throw conflict("You are the last administrator; make someone else an admin first", "LAST_ADMIN");
  }
}

/** Ask for deletion: signed out everywhere now, erased after the grace period. */
export async function requestDeletion(actor: Actor, input: { password: string; totp?: string; recoveryCode?: string }, meta: RequestMeta): Promise<{ purgeAfter: string }> {
  const user = await confirmIdentity(actor, input);
  await assertCanLeave(user.id, user.role);
  const now = new Date();
  await withTransaction(async (trx) => {
    await trx.updateTable("users").set({ deletion_requested_at: now, updated_at: now }).where("id", "=", user.id).execute();
    await sessionRepo.revokeAllForUser(user.id, trx);
    await userRepo.bumpTokenVersion(user.id, trx);
    await trx.deleteFrom("push_devices").where("user_id", "=", user.id).execute();
    await audit({ actorId: user.id, action: "user.deletion_requested", entityType: "user", entityId: user.id, ip: meta.ip }, trx);
  });
  return { purgeAfter: new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000).toISOString() };
}

/** Signing in during the grace period keeps the account. Called by auth.service on a successful login. */
export async function cancelDeletionOnSignIn(userId: string, exec: Executor = db): Promise<boolean> {
  const r = await exec.updateTable("users").set({ deletion_requested_at: null }).where("id", "=", userId).where("deletion_requested_at", "is not", null).executeTakeFirst();
  const cancelled = Number(r.numUpdatedRows) > 0;
  if (cancelled) await audit({ actorId: userId, action: "user.deletion_cancelled", entityType: "user", entityId: userId }, exec);
  return cancelled;
}

/** Strip everything that identifies a person (see the header). Runs inside the caller's transaction. */
export async function anonymiseUser(id: string, trx: Executor): Promise<void> {
  const now = new Date();
  const unusable = await hashPassword(randomToken());
  await trx
    .updateTable("users")
    .set({
      status: "DEACTIVATED",
      role: "LEARNER",
      email: `deleted+${id.toLowerCase()}@invalid.example`,
      username: `deleted-${id.slice(-12).toLowerCase()}`,
      display_name: DELETED_DISPLAY_NAME,
      certificate_name: null,
      headline: null,
      bio: null,
      website: null,
      avatar_upload_id: null,
      password_hash: unusable,
      totp_enabled: false,
      totp_secret: null,
      totp_last_step: null,
      email_preferences: JSON.stringify({}),
      push_preferences: JSON.stringify({}),
      suspended_until: null,
      deletion_requested_at: null,
      updated_at: now,
    })
    .where("id", "=", id)
    .execute();
  await recoveryCodeRepo.deleteAll(id, trx);
  await trx.deleteFrom("auth_tokens").where("user_id", "=", id).execute();
  await sessionRepo.revokeAllForUser(id, trx);
  await userRepo.bumpTokenVersion(id, trx);

  await trx.deleteFrom("notes").where("user_id", "=", id).execute();
  await trx.deleteFrom("bookmarks").where("user_id", "=", id).execute();
  await trx.deleteFrom("saved_courses").where("user_id", "=", id).execute();
  await trx.deleteFrom("certificates").where("user_id", "=", id).execute();
  await trx.deleteFrom("course_staff").where("user_id", "=", id).execute();
  await trx.updateTable("quiz_attempts").set({ answers: JSON.stringify({}) }).where("user_id", "=", id).execute();
  await trx.deleteFrom("submission_files").where("submission_id", "in", trx.selectFrom("assignment_submissions").select("id").where("user_id", "=", id)).execute();
  await trx.updateTable("assignment_submissions").set({ body: null, url: null, ai_suggestion: null }).where("user_id", "=", id).execute();
  // Uploads they own (avatar, submission files) are marked deleted; the expire job removes the objects.
  await trx.updateTable("media_uploads").set({ status: "DELETED" }).where("owner_id", "=", id).where("purpose", "in", ["AVATAR", "SUBMISSION"]).execute();
  await trx.updateTable("orders").set({ billing: JSON.stringify({}) }).where("user_id", "=", id).execute();
  await trx.deleteFrom("notifications").where("recipient_id", "=", id).execute();
  await trx.deleteFrom("push_devices").where("user_id", "=", id).execute();
  await trx.deleteFrom("offline_downloads").where("user_id", "=", id).execute();
}

// ─── Export ─────────────────────────────────────────────────────────────────

const EXPORT_PAGE = 500;

type Section = { name: string; query: (after: string | null) => Promise<{ id: string }[]> };

function sections(userId: string): Section[] {
  const after = <Q extends { where: (...a: any[]) => Q }>(q: Q, col: string, cursor: string | null): Q => (cursor ? q.where(col, ">", cursor) : q);
  return [
    { name: "enrollments", query: (c) => after(db.selectFrom("enrollments as e").innerJoin("courses as c", "c.id", "e.course_id").select(["e.id", "c.slug as course", "e.source", "e.status", "e.progress_percent", "e.completed_at", "e.valid_until", "e.created_at"]).where("e.user_id", "=", userId), "e.id", c).orderBy("e.id").limit(EXPORT_PAGE).execute() },
    { name: "notes", query: (c) => after(db.selectFrom("notes").select(["id", "course_id", "item_id", "at_seconds", "body", "created_at", "updated_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "quizAttempts", query: (c) => after(db.selectFrom("quiz_attempts").select(["id", "quiz_item_id", "number", "status", "answers", "score_points", "max_points", "percent", "passed", "started_at", "submitted_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "submissions", query: (c) => after(db.selectFrom("assignment_submissions").select(["id", "item_id", "version", "body", "url", "status", "scores", "total_points", "feedback", "submitted_at", "reviewed_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "reviews", query: (c) => after(db.selectFrom("reviews").select(["id", "course_id", "rating", "body", "status", "created_at", "updated_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "questions", query: (c) => after(db.selectFrom("qa_threads").select(["id", "course_id", "item_id", "title", "body", "status", "created_at"]).where("author_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "answers", query: (c) => after(db.selectFrom("qa_replies").select(["id", "thread_id", "body", "status", "created_at"]).where("author_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "orders", query: (c) => after(db.selectFrom("orders").select(["id", "number", "kind", "status", "currency", "subtotal_minor", "discount_minor", "tax_minor", "total_minor", "refunded_minor", "coupon_code", "gateway", "paid_at", "created_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "invoices", query: (c) => after(db.selectFrom("invoices").select(["id", "number", "kind", "currency", "total_minor", "issued_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "subscriptions", query: (c) => after(db.selectFrom("subscriptions").select(["id", "plan_id", "status", "currency", "amount_minor", "interval", "current_period_end", "cancel_at_period_end", "created_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "certificates", query: (c) => after(db.selectFrom("certificates").select(["id", "serial", "course_title", "learner_name", "issued_at", "revoked_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
    { name: "notifications", query: (c) => after(db.selectFrom("notifications").select(["id", "type", "entity_type", "entity_id", "snippet", "read_at", "created_at"]).where("recipient_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
  ];
}

/** Stream the caller's data as one JSON document: { exportedAt, account, enrollments: [...], ... }. */
export async function exportAccount(actor: Actor, res: Response): Promise<void> {
  const user = await userRepo.findById(actor.id);
  if (!user) return void res.status(404).end();
  const account = { ...(await toMe(user)), createdAt: user.created_at.toISOString() };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${user.username}-export.json"`);
  res.setHeader("Cache-Control", "no-store");
  const write = (chunk: string) => new Promise<void>((resolve) => (res.write(chunk) ? resolve() : res.once("drain", resolve)));
  await write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"account":${JSON.stringify(account)}`);
  for (const section of sections(user.id)) {
    await write(`,${JSON.stringify(section.name)}:[`);
    let cursor: string | null = null;
    let first = true;
    for (;;) {
      const rows = await section.query(cursor);
      for (const row of rows) {
        await write(`${first ? "" : ","}${JSON.stringify(row)}`);
        first = false;
      }
      if (rows.length < EXPORT_PAGE) break;
      cursor = rows[rows.length - 1]!.id;
    }
    await write("]");
  }
  await write("}");
  res.end();
  await audit({ actorId: user.id, action: "user.export", entityType: "user", entityId: user.id });
}
