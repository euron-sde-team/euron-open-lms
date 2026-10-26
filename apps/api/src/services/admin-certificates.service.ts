/**
 * Certificates in the console (area "certificates": ADMIN and SUPPORT): find, revoke
 * with a reason, restore. Both are conditional UPDATEs on revoked_at, audited in the
 * same transaction. The public verify page (GET /api/certificates/:serial) reads
 * revoked_at, so a revoked certificate says so there at once.
 */
import type { AdminCertificateRow, Page } from "@open-lms/types";
import { requireArea, type Actor, type RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, notFound } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { loadSummaries } from "../presenters/user.presenter";
import { atKey, decodeTime, olderThan, timePage } from "../repositories/keyset";
import { userNameLike } from "../repositories/text-search";
import { audit } from "./audit.service";

const COLUMNS = ["c.id", "c.serial", "c.user_id", "c.learner_name", "c.course_title", "c.issued_at", "c.revoked_at", "c.revoked_reason", "u.email"] as const;

function base(exec: Executor) {
  return exec.selectFrom("certificates as c").innerJoin("users as u", "u.id", "c.user_id").select([...COLUMNS, atKey("c.issued_at")]);
}

type Row = Awaited<ReturnType<ReturnType<typeof base>["execute"]>>[number];

async function present(rows: readonly Row[], exec: Executor = db): Promise<AdminCertificateRow[]> {
  const people = await loadSummaries(rows.map((r) => r.user_id), exec);
  return rows.flatMap((r) => {
    const s = people.get(r.user_id);
    if (!s) return [];
    return [{ id: r.id, serial: r.serial, learner: { ...s, email: String(r.email) }, learnerName: r.learner_name, courseTitle: r.course_title, issuedAt: r.issued_at.toISOString(), revokedAt: r.revoked_at?.toISOString() ?? null, revokedReason: r.revoked_reason }];
  });
}

/** `q` matches a serial exactly (any case) or the learner's name, username or email. */
export async function listCertificates(actor: Actor, q: { q?: string; cursor?: string; limit: number }): Promise<Page<AdminCertificateRow>> {
  requireArea(actor, "certificates");
  let query = base(db);
  const text = q.q?.trim();
  if (text) query = query.where((eb) => eb.or([eb("c.serial", "=", text.toUpperCase()), userNameLike("u", text)]));
  const rows = await query.where(olderThan("c.issued_at", "c.id", decodeTime(q.cursor))).orderBy("c.issued_at", "desc").orderBy("c.id", "desc").limit(q.limit + 1).execute();
  const page = timePage(rows, q.limit);
  return { items: await present(page.items), nextCursor: page.nextCursor };
}

async function one(id: string, exec: Executor = db): Promise<AdminCertificateRow> {
  const row = await base(exec).where("c.id", "=", id).executeTakeFirst();
  if (!row) throw notFound("Certificate not found", "CERTIFICATE_NOT_FOUND");
  return (await present([row], exec))[0]!;
}

export async function revokeCertificate(actor: Actor, id: string, reason: string, meta: RequestMeta): Promise<AdminCertificateRow> {
  requireArea(actor, "certificates");
  await withTransaction(async (trx) => {
    const r = await trx.updateTable("certificates").set({ revoked_at: new Date(), revoked_reason: reason, revoked_by: actor.id }).where("id", "=", id).where("revoked_at", "is", null).returning(["serial", "user_id"]).executeTakeFirst();
    if (!r) {
      await one(id, trx);
      throw conflict("This certificate is already revoked", "CERTIFICATE_REVOKED");
    }
    await audit({ actorId: actor.id, action: "certificate.revoke", entityType: "certificate", entityId: id, ip: meta.ip, data: { serial: r.serial, userId: r.user_id, reason } }, trx);
  });
  return one(id);
}

export async function restoreCertificate(actor: Actor, id: string, meta: RequestMeta): Promise<AdminCertificateRow> {
  requireArea(actor, "certificates");
  await withTransaction(async (trx) => {
    const before = await trx.selectFrom("certificates").select(["revoked_reason"]).where("id", "=", id).forUpdate().executeTakeFirst();
    if (!before) throw notFound("Certificate not found", "CERTIFICATE_NOT_FOUND");
    const r = await trx.updateTable("certificates").set({ revoked_at: null, revoked_reason: null, revoked_by: null }).where("id", "=", id).where("revoked_at", "is not", null).returning(["serial", "user_id"]).executeTakeFirst();
    if (!r) throw conflict("This certificate is not revoked", "CERTIFICATE_NOT_REVOKED");
    await audit({ actorId: actor.id, action: "certificate.restore", entityType: "certificate", entityId: id, ip: meta.ip, data: { serial: r.serial, userId: r.user_id, previousReason: before.revoked_reason } }, trx);
  });
  return one(id);
}
