/**
 * Reports on community content (reviews, Q&A threads and replies) and the moderation
 * queue. UNIQUE (target_type, target_id, reporter_id): one report per reporter per
 * target. Resolving a report closes every open report on the same target.
 */
import type { Insertable, Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Reports } from "../db/types";
import { atKey, newerThan, olderThan, type TimeKey } from "./keyset";

export type ReportRow = Selectable<Reports>;
export type TargetType = ReportRow["target_type"];

export class ReportRepository {
  findById(id: string, exec: Executor = db): Promise<ReportRow | undefined> {
    return exec.selectFrom("reports").selectAll().where("id", "=", id).executeTakeFirst();
  }

  lock(id: string, exec: Executor): Promise<ReportRow | undefined> {
    return exec.selectFrom("reports").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
  }

  /** Insert, or return the reporter's existing report on the same target. */
  async insertOnce(row: Insertable<Reports>, exec: Executor = db): Promise<{ id: string; created: boolean }> {
    const inserted = await exec.insertInto("reports").values(row).onConflict((oc) => oc.columns(["target_type", "target_id", "reporter_id"]).doNothing()).returning("id").executeTakeFirst();
    if (inserted) return { id: inserted.id, created: true };
    const existing = await exec
      .selectFrom("reports")
      .select("id")
      .where("target_type", "=", row.target_type)
      .where("target_id", "=", row.target_id)
      .where("reporter_id", "=", row.reporter_id)
      .executeTakeFirstOrThrow();
    return { id: existing.id, created: false };
  }

  /** Close every OPEN report on a target. Returns how many closed. */
  async closeOpen(target: { type: TargetType; id: string }, v: { resolution: string; resolvedBy: string | null }, exec: Executor): Promise<number> {
    const r = await exec
      .updateTable("reports")
      .set({ status: "RESOLVED", resolution: v.resolution, resolved_by: v.resolvedBy, resolved_at: new Date() })
      .where("target_type", "=", target.type)
      .where("target_id", "=", target.id)
      .where("status", "=", "OPEN")
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  /** The queue: OPEN oldest first (reports_open_idx), RESOLVED newest first. */
  list(f: { status: ReportRow["status"]; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    const q = exec.selectFrom("reports as r").selectAll("r").select(atKey("r.created_at")).where("r.status", "=", f.status);
    return (
      f.status === "OPEN"
        ? q.where(newerThan("r.created_at", "r.id", f.cursor)).orderBy("r.created_at", "asc").orderBy("r.id", "asc")
        : q.where(olderThan("r.created_at", "r.id", f.cursor)).orderBy("r.created_at", "desc").orderBy("r.id", "desc")
    )
      .limit(f.limit + 1)
      .execute();
  }

  /** OPEN reports per target, for "n other reports" (one grouped query for a page). */
  async openCounts(targetIds: readonly string[], exec: Executor = db): Promise<Map<string, number>> {
    if (!targetIds.length) return new Map();
    const rows = await exec
      .selectFrom("reports")
      .select(["target_type", "target_id", (eb) => eb.fn.countAll<number>().as("n")])
      .where("target_id", "in", [...new Set(targetIds)])
      .where("status", "=", "OPEN")
      .groupBy(["target_type", "target_id"])
      .execute();
    return new Map(rows.map((r) => [`${r.target_type}:${r.target_id}`, Number(r.n)]));
  }
}

export const reportRepo = new ReportRepository();
