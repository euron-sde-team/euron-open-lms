/**
 * The learners console (area "learners": ADMIN and SUPPORT): find people, see their
 * enrollments, subscription, orders and certificates, grant and revoke access, and
 * restrict accounts.
 *
 * Rules:
 *   - access is only ever given or taken through services/enrollment.service.ts
 *     (grantEnrollment with source GRANT, revokeEnrollment), which keeps the counters,
 *     the audit trail and the learner's notification;
 *   - account actions are conditional UPDATEs on the expected status, so two operators
 *     clicking at once produce one change and one 409;
 *   - nobody acts on their own account, and staff are protected from their peers and
 *     juniors: you may act on a learner, or on a staff role strictly below yours. An
 *     ADMIN is therefore never suspended, banned or erased from here (demote first),
 *     which also means the last admin can never be locked out;
 *   - a ban signs the person out everywhere at once (sessions revoked, token_version
 *     bumped); a suspension leaves them signed in but read-only (core/context.ts
 *     requireActive), and maintenance.lift-suspensions ends it on time;
 *   - erase (ADMIN only) runs account.service.ts anonymiseUser in one transaction, and
 *     is refused while the person has a live subscription (cancel it first, so the
 *     gateway stops charging).
 */
import type { AdminEnrollment, AdminLearnerDetail, AdminUserRow, Page, UserRole, UserStatus } from "@open-lms/types";
import { requireArea, type Actor, type RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import type { Executor } from "../db/kysely";
import { adminUserRows, enrollmentById, presentEnrollments, presentOrderRows } from "../presenters/admin-learners.presenter";
import { liveSubscriptionOf } from "../presenters/subscription.presenter";
import { adminLearnersRepo } from "../repositories/admin-learners.repository";
import { decodeTime, timePage } from "../repositories/keyset";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo } from "../repositories/user.repository";
import { findCourse } from "./access.service";
import { anonymiseUser } from "./account.service";
import { audit } from "./audit.service";
import { grantEnrollment, revokeEnrollment } from "./enrollment.service";

const RANK: Record<UserRole, number> = { LEARNER: 0, INSTRUCTOR: 1, SUPPORT: 2, FINANCE: 2, ADMIN: 3 };
const ERASED_EMAIL = /@invalid\.example$/i;

/** May `actor` act on an account with this id and role? Pure, exported for the unit tests. */
export function protectionOf(actor: { id: string; role: UserRole }, target: { id: string; role: UserRole }): "SELF_ACTION" | "TARGET_PROTECTED" | null {
  if (actor.id === target.id) return "SELF_ACTION";
  if (target.role !== "LEARNER" && RANK[target.role] >= RANK[actor.role]) return "TARGET_PROTECTED";
  return null;
}

function assertCanActOn(actor: Actor, target: { id: string; role: UserRole }): void {
  const p = protectionOf(actor, target);
  if (p === "SELF_ACTION") throw forbidden("You cannot do this to your own account", "SELF_ACTION");
  if (p === "TARGET_PROTECTED") throw forbidden("This account belongs to a staff member at or above your level", "TARGET_PROTECTED");
}

async function lockUser(id: string, exec: Executor) {
  const u = await exec.selectFrom("users").select(["id", "role", "status", "email", "email_verified_at"]).where("id", "=", id).forUpdate().executeTakeFirst();
  if (!u) throw notFound("User not found", "USER_NOT_FOUND");
  return u;
}

async function rowOf(id: string): Promise<AdminUserRow> {
  const [row] = await adminUserRows([id]);
  if (!row) throw notFound("User not found", "USER_NOT_FOUND");
  return row;
}

// ─── Reading ────────────────────────────────────────────────────────────────

export async function listLearners(actor: Actor, q: { q?: string; status?: UserStatus; cursor?: string; limit: number }): Promise<Page<AdminUserRow>> {
  requireArea(actor, "learners");
  const page = timePage(await adminLearnersRepo.list({ q: q.q?.trim() || undefined, status: q.status, cursor: decodeTime(q.cursor), limit: q.limit }), q.limit);
  return { items: await adminUserRows(page.items.map((r) => r.id)), nextCursor: page.nextCursor };
}

export async function learnerDetail(actor: Actor, id: string): Promise<AdminLearnerDetail> {
  requireArea(actor, "learners");
  const [row] = await adminUserRows([id]);
  const account = (await adminLearnersRepo.accounts([id]))[0];
  if (!row || !account) throw notFound("User not found", "USER_NOT_FOUND");
  const [enrollmentRows, sub, orders, certificates] = await Promise.all([
    adminLearnersRepo.enrollments({ userId: id }),
    liveSubscriptionOf(id),
    adminLearnersRepo.recentOrders(id, 10),
    adminLearnersRepo.certificates(id),
  ]);
  const { enrollmentCount: _c, totalSpent: _t, email, status, createdAt: _a, lastSeenAt: _l, suspendedUntil: _s, ...summary } = row;
  return {
    ...row,
    bio: account.bio,
    emailVerified: !!account.email_verified_at,
    totpEnabled: account.totp_enabled,
    enrollments: await presentEnrollments(enrollmentRows, { id, status }),
    subscription: sub ? { id: sub.id, plan: sub.plan.name, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd } : null,
    recentOrders: presentOrderRows(orders, { ...summary, email }),
    certificates: certificates.map((c) => ({ serial: c.serial, courseTitle: c.course_title, issuedAt: c.issued_at.toISOString(), revoked: !!c.revoked_at })),
  };
}

// ─── Enrollments ────────────────────────────────────────────────────────────

function futureOrNull(validUntil: string | null | undefined): Date | null {
  if (!validUntil) return null;
  const d = new Date(validUntil);
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) throw badRequest("The end date must be in the future", "VALID_UNTIL_PAST");
  return d;
}

/** POST /admin/learners/:id/enrollments: a GRANT (never shortens existing access). */
export async function grantAccess(actor: Actor, userId: string, input: { courseId: string; validUntil?: string | null; note?: string | null }): Promise<AdminEnrollment> {
  requireArea(actor, "learners");
  const validUntil = futureOrNull(input.validUntil);
  const [user, course] = await Promise.all([userRepo.findAuthById(userId), findCourse({ id: input.courseId })]);
  if (!user) throw notFound("User not found", "USER_NOT_FOUND");
  if (!course) throw notFound("Course not found", "COURSE_NOT_FOUND");
  if (user.status === "DEACTIVATED") throw conflict("This account is deactivated", "USER_INACTIVE");
  // grantEnrollment writes the enrollment.grant audit entry in the same transaction.
  const { id } = await withTransaction((trx, fx) => grantEnrollment({ userId, courseId: course.id, source: "GRANT", grantedBy: actor.id, note: input.note?.trim() || null, validUntil, notifyLearner: true }, trx, fx));
  return (await enrollmentById(id)) as AdminEnrollment;
}

/** POST /admin/enrollments/:id/revoke: ends access, keeps the row and the progress. */
export async function revokeAccess(actor: Actor, enrollmentId: string, reason: string): Promise<AdminEnrollment> {
  requireArea(actor, "learners");
  const done = await withTransaction(async (trx, fx) => {
    const exists = await trx.selectFrom("enrollments").select(["id", "status"]).where("id", "=", enrollmentId).executeTakeFirst();
    if (!exists) throw notFound("Enrollment not found", "ENROLLMENT_NOT_FOUND");
    return revokeEnrollment({ enrollmentId, reason, actorId: actor.id, notifyLearner: true }, trx, fx);
  });
  if (!done) throw conflict("This enrollment is already revoked", "ENROLLMENT_NOT_ACTIVE");
  return (await enrollmentById(enrollmentId)) as AdminEnrollment;
}

/** PATCH /admin/enrollments/:id: move the end date (null = for life). Active, non-subscription rows only. */
export async function setValidUntil(actor: Actor, enrollmentId: string, validUntil: string | null, meta: RequestMeta): Promise<AdminEnrollment> {
  requireArea(actor, "learners");
  const until = futureOrNull(validUntil);
  await withTransaction(async (trx) => {
    const row = await trx.selectFrom("enrollments").select(["id", "status", "source", "valid_until", "user_id", "course_id"]).where("id", "=", enrollmentId).forUpdate().executeTakeFirst();
    if (!row) throw notFound("Enrollment not found", "ENROLLMENT_NOT_FOUND");
    if (row.source === "SUBSCRIPTION") throw conflict("Access through a subscription ends with the subscription", "ENROLLMENT_SUBSCRIPTION");
    const r = await trx.updateTable("enrollments").set({ valid_until: until, updated_at: new Date() }).where("id", "=", enrollmentId).where("status", "=", "ACTIVE").executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw conflict("This enrollment is revoked; grant access again instead", "ENROLLMENT_NOT_ACTIVE");
    await audit({ actorId: actor.id, action: "enrollment.valid_until", entityType: "enrollment", entityId: enrollmentId, ip: meta.ip, data: { userId: row.user_id, courseId: row.course_id, from: row.valid_until?.toISOString() ?? null, to: until?.toISOString() ?? null } }, trx);
  });
  return (await enrollmentById(enrollmentId)) as AdminEnrollment;
}

// ─── Account actions ────────────────────────────────────────────────────────

/** Suspend for `days` (or extend a running suspension). Read-only until it ends. */
export async function suspend(actor: Actor, userId: string, input: { days: number; reason: string }, meta: RequestMeta): Promise<AdminUserRow> {
  requireArea(actor, "learners");
  const until = new Date(Date.now() + input.days * 86_400_000);
  await withTransaction(async (trx) => {
    const u = await lockUser(userId, trx);
    assertCanActOn(actor, u);
    const r = await trx.updateTable("users").set({ status: "SUSPENDED", suspended_until: until, updated_at: new Date() }).where("id", "=", userId).where("status", "in", ["ACTIVE", "SUSPENDED"]).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw conflict(`Only an active account can be suspended (this one is ${u.status.toLowerCase()})`, "INVALID_STATUS");
    await audit({ actorId: actor.id, action: "user.suspend", entityType: "user", entityId: userId, ip: meta.ip, data: { days: input.days, until: until.toISOString(), reason: input.reason, from: u.status } }, trx);
  });
  return rowOf(userId);
}

export async function unsuspend(actor: Actor, userId: string, meta: RequestMeta): Promise<AdminUserRow> {
  requireArea(actor, "learners");
  await withTransaction(async (trx) => {
    const u = await lockUser(userId, trx);
    assertCanActOn(actor, u);
    const r = await trx.updateTable("users").set({ status: "ACTIVE", suspended_until: null, updated_at: new Date() }).where("id", "=", userId).where("status", "=", "SUSPENDED").executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw conflict("This account is not suspended", "INVALID_STATUS");
    await audit({ actorId: actor.id, action: "user.unsuspend", entityType: "user", entityId: userId, ip: meta.ip }, trx);
  });
  return rowOf(userId);
}

/** Ban: no sign-in, every session and access token dead on the next request. */
export async function ban(actor: Actor, userId: string, reason: string, meta: RequestMeta): Promise<AdminUserRow> {
  requireArea(actor, "learners");
  await withTransaction(async (trx) => {
    const u = await lockUser(userId, trx);
    assertCanActOn(actor, u);
    const r = await trx.updateTable("users").set({ status: "BANNED", suspended_until: null, updated_at: new Date() }).where("id", "=", userId).where("status", "in", ["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"]).executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw conflict(`This account cannot be banned (it is ${u.status.toLowerCase()})`, "INVALID_STATUS");
    await sessionRepo.revokeAllForUser(userId, trx);
    await userRepo.bumpTokenVersion(userId, trx);
    await audit({ actorId: actor.id, action: "user.ban", entityType: "user", entityId: userId, ip: meta.ip, data: { reason, from: u.status } }, trx);
  });
  return rowOf(userId);
}

/** Unban: back to ACTIVE (or to PENDING_VERIFICATION when the email was never confirmed). */
export async function unban(actor: Actor, userId: string, meta: RequestMeta): Promise<AdminUserRow> {
  requireArea(actor, "learners");
  await withTransaction(async (trx) => {
    const u = await lockUser(userId, trx);
    assertCanActOn(actor, u);
    const to = u.email_verified_at ? "ACTIVE" : "PENDING_VERIFICATION";
    const r = await trx.updateTable("users").set({ status: to, updated_at: new Date() }).where("id", "=", userId).where("status", "=", "BANNED").executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw conflict("This account is not banned", "INVALID_STATUS");
    await audit({ actorId: actor.id, action: "user.unban", entityType: "user", entityId: userId, ip: meta.ip, data: { to } }, trx);
  });
  return rowOf(userId);
}

/** POST /admin/learners/:id/erase (ADMIN only): anonymise now, keeping financial records. */
export async function erase(actor: Actor, userId: string, reason: string, meta: RequestMeta): Promise<void> {
  requireArea(actor, "learners");
  if (actor.role !== "ADMIN") throw forbidden("Only an administrator can erase an account", "FORBIDDEN_AREA");
  await withTransaction(async (trx) => {
    const u = await lockUser(userId, trx);
    assertCanActOn(actor, u);
    if (ERASED_EMAIL.test(String(u.email))) throw conflict("This account was already erased", "ALREADY_ERASED");
    if (await adminLearnersRepo.hasLiveSubscription(userId, trx)) throw conflict("Cancel this learner's subscription before erasing the account", "SUBSCRIPTION_ACTIVE");
    await anonymiseUser(userId, trx);
    await audit({ actorId: actor.id, action: "user.erase", entityType: "user", entityId: userId, ip: meta.ip, data: { reason } }, trx);
  });
}
