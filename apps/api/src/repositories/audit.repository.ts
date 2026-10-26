/**
 * Reading the audit trail (writes go through services/audit.service.ts `audit()`, inside
 * the transaction of the change they record). Newest first, keyset on
 * (created_at, id), which audit_log_recent_idx serves; the actor and entity filters
 * have their own indexes.
 */
import { db, type Executor } from "../db/kysely";
import { atKey, olderThan, type TimeKey } from "./keyset";

export interface AuditFilter {
  /** An action prefix ("enrollment." matches every enrollment action). Matched literally. */
  action?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
}

export class AuditRepository {
  list(filter: AuditFilter, opts: { cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec.selectFrom("audit_log as a").select(["a.id", "a.actor_id", "a.action", "a.entity_type", "a.entity_id", "a.data", "a.created_at", atKey("a.created_at")]);
    if (filter.action) q = q.where("a.action", "like", `${filter.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    if (filter.actorId) q = q.where("a.actor_id", "=", filter.actorId);
    if (filter.entityType) q = q.where("a.entity_type", "=", filter.entityType);
    if (filter.entityId) q = q.where("a.entity_id", "=", filter.entityId);
    return q.where(olderThan("a.created_at", "a.id", opts.cursor)).orderBy("a.created_at", "desc").orderBy("a.id", "desc").limit(opts.limit + 1).execute();
  }
}

export const auditRepo = new AuditRepository();
