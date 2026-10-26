/**
 * Staff and roles (area "staff": ADMIN only). Listing shows every non-learner account
 * with the number of courses it is on the staff of; PATCH /admin/staff/:userId changes
 * a platform role (promoting a learner to INSTRUCTOR is the same call).
 *
 * Rules:
 *   - nobody changes their own role (403 CANNOT_CHANGE_OWN_ROLE);
 *   - the academy always keeps one ACTIVE admin: every admin row is locked before the
 *     check, so two concurrent demotions cannot both pass (409 LAST_ADMIN);
 *   - banned and erased accounts cannot be given a staff role (409 USER_INACTIVE);
 *   - every change is audited as user.role_change with from and to.
 * Demoting an INSTRUCTOR to LEARNER keeps their course_staff rows (an admin may
 * reassign the courses later, and the history of who taught stays intact), but they
 * lose /admin entirely: every admin route checks the platform role first.
 */
import type { Page, StaffRow, UserRole } from "@open-lms/types";
import { requireArea, type Actor, type RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, forbidden, notFound } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { loadSummaries } from "../presenters/user.presenter";
import { decodeTime, timePage } from "../repositories/keyset";
import { staffRepo } from "../repositories/staff.repository";
import { audit } from "./audit.service";

async function staffRows(ids: readonly string[], exec: Executor = db): Promise<StaffRow[]> {
  const [rows, people] = await Promise.all([staffRepo.rows(ids, exec), loadSummaries(ids, exec)]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    const s = people.get(id);
    return r && s ? [{ ...s, email: String(r.email), status: r.status, courseCount: Number(r.course_count ?? 0), createdAt: r.created_at.toISOString() }] : [];
  });
}

export async function listStaff(actor: Actor, q: { role?: Exclude<UserRole, "LEARNER">; q?: string; cursor?: string; limit: number }): Promise<Page<StaffRow>> {
  requireArea(actor, "staff");
  const page = timePage(await staffRepo.list({ role: q.role, q: q.q?.trim() || undefined, cursor: decodeTime(q.cursor), limit: q.limit }), q.limit);
  return { items: await staffRows(page.items.map((r) => r.id)), nextCursor: page.nextCursor };
}

export async function changeRole(actor: Actor, userId: string, role: UserRole, meta: RequestMeta): Promise<StaffRow> {
  requireArea(actor, "staff");
  if (userId === actor.id) throw forbidden("You cannot change your own role", "CANNOT_CHANGE_OWN_ROLE");
  await withTransaction(async (trx) => {
    // Lock every active admin first, in a stable order, then the target.
    const admins = await trx.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").orderBy("id").forUpdate().execute();
    const user = await trx.selectFrom("users").select(["id", "role", "status"]).where("id", "=", userId).forUpdate().executeTakeFirst();
    if (!user) throw notFound("User not found", "USER_NOT_FOUND");
    if (user.role === role) return;
    if (role !== "LEARNER" && (user.status === "BANNED" || user.status === "DEACTIVATED")) throw conflict("A banned or erased account cannot hold a staff role", "USER_INACTIVE");
    if (user.role === "ADMIN" && !admins.some((a) => a.id !== userId)) throw conflict("The academy needs at least one active admin", "LAST_ADMIN");
    await trx.updateTable("users").set({ role, updated_at: new Date() }).where("id", "=", userId).where("role", "=", user.role).execute();
    await audit({ actorId: actor.id, action: "user.role_change", entityType: "user", entityId: userId, ip: meta.ip, data: { from: user.role, to: role } }, trx);
  });
  const [row] = await staffRows([userId]);
  if (!row) throw notFound("User not found", "USER_NOT_FOUND");
  return row;
}
