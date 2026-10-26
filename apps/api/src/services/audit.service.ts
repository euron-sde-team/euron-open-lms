/**
 * Append-only audit trail for security and administrative actions. `audit()` runs inside
 * the transaction of the change it records, so a rolled-back change leaves no entry and
 * a committed one always has its entry. `listAudit` is the /admin/audit reader (ADMIN only).
 */
import type { AuditEntry, Page } from "@open-lms/types";
import { requireArea, type Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { newId } from "../core/ids";
import { loadSummaries } from "../presenters/user.presenter";
import { auditRepo, type AuditFilter } from "../repositories/audit.repository";
import { decodeTime, timePage } from "../repositories/keyset";

export function audit(
  entry: { actorId: string | null; action: string; entityType: string; entityId?: string | null; ip?: string | null; data?: Record<string, unknown> },
  exec: Executor = db,
) {
  return exec
    .insertInto("audit_log")
    .values({
      id: newId(),
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      ip: entry.ip ?? null,
      data: JSON.stringify(entry.data ?? {}),
    })
    .execute();
}

/** GET /api/admin/audit: newest first, filtered, with the actors as person cards. */
export async function listAudit(actor: Actor, q: AuditFilter & { cursor?: string; limit: number }): Promise<Page<AuditEntry>> {
  requireArea(actor, "audit");
  const page = timePage(await auditRepo.list(q, { cursor: decodeTime(q.cursor), limit: q.limit }), q.limit);
  const people = await loadSummaries(page.items.map((r) => r.actor_id));
  return {
    items: page.items.map((r) => ({
      id: r.id,
      actor: r.actor_id ? (people.get(r.actor_id) ?? null) : null,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      data: (r.data && typeof r.data === "object" ? r.data : {}) as Record<string, unknown>,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}
