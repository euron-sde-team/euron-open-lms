/** Offline download licences (one per learner, item and device). Every learner query is scoped by the owner's id. */
import { db, type Executor } from "../db/kysely";
import { atKey, olderThan, type TimeKey } from "./keyset";

export class OfflineDownloadRepository {
  /** Active licences (not revoked, inside their window) other than this item on this device. */
  async countActiveExcept(userId: string, itemId: string, deviceId: string, exec: Executor = db): Promise<number> {
    const r = await exec
      .selectFrom("offline_downloads")
      .select((eb) => eb.fn.countAll<number>().as("n"))
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .where("expires_at", ">", new Date())
      .where((eb) => eb.not(eb.and([eb("item_id", "=", itemId), eb("device_id", "=", deviceId)])))
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** Insert or renew the licence: a fresh window, and a revoked one is issued again. */
  upsert(row: { id: string; user_id: string; item_id: string; course_id: string; device_id: string; expires_at: Date }, exec: Executor = db) {
    return exec
      .insertInto("offline_downloads")
      .values(row)
      .onConflict((oc) => oc.columns(["user_id", "item_id", "device_id"]).doUpdateSet({ expires_at: row.expires_at, revoked_at: null, course_id: row.course_id }))
      .returning(["id", "expires_at"])
      .executeTakeFirstOrThrow();
  }

  /** The device's licences for these items, with what decides whether each may keep playing. */
  forDevice(userId: string, deviceId: string, itemIds: string[], exec: Executor = db) {
    if (!itemIds.length) return Promise.resolve([]);
    return exec
      .selectFrom("offline_downloads as d")
      .innerJoin("courses as c", "c.id", "d.course_id")
      .leftJoin("lectures as l", "l.item_id", "d.item_id")
      .select(["d.id", "d.item_id", "d.course_id", "d.revoked_at", "c.allow_downloads", "l.lecture_kind", "l.video_provider"])
      .where("d.user_id", "=", userId)
      .where("d.device_id", "=", deviceId)
      .where("d.item_id", "in", itemIds)
      .execute();
  }

  async extend(ids: string[], expiresAt: Date, exec: Executor = db): Promise<void> {
    if (ids.length) await exec.updateTable("offline_downloads").set({ expires_at: expiresAt }).where("id", "in", ids).where("revoked_at", "is", null).execute();
  }

  async revoke(ids: string[], exec: Executor = db): Promise<void> {
    if (ids.length) await exec.updateTable("offline_downloads").set({ revoked_at: new Date() }).where("id", "in", ids).where("revoked_at", "is", null).execute();
  }

  async deleteOwn(userId: string, itemId: string, deviceId: string, exec: Executor = db): Promise<void> {
    await exec.deleteFrom("offline_downloads").where("user_id", "=", userId).where("item_id", "=", itemId).where("device_id", "=", deviceId).execute();
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  /** A learner's licences, newest first (keyset on created_at, id). */
  listForUser(userId: string, opts: { cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    return exec
      .selectFrom("offline_downloads as d")
      .innerJoin("courses as c", "c.id", "d.course_id")
      .innerJoin("course_items as i", "i.id", "d.item_id")
      .select(["d.id", "d.item_id", "d.course_id", "d.device_id", "d.created_at", "d.expires_at", "d.revoked_at", "c.slug as course_slug", "c.title as course_title", "i.title as item_title", atKey("d.created_at")])
      .where("d.user_id", "=", userId)
      .where(olderThan("d.created_at", "d.id", opts.cursor))
      .orderBy("d.created_at", "desc")
      .orderBy("d.id", "desc")
      .limit(opts.limit + 1)
      .execute();
  }

  byId(id: string, exec: Executor = db) {
    return exec
      .selectFrom("offline_downloads as d")
      .innerJoin("courses as c", "c.id", "d.course_id")
      .innerJoin("course_items as i", "i.id", "d.item_id")
      .select(["d.id", "d.user_id", "d.item_id", "d.course_id", "d.device_id", "d.created_at", "d.expires_at", "d.revoked_at", "c.slug as course_slug", "c.title as course_title", "i.title as item_title"])
      .where("d.id", "=", id)
      .executeTakeFirst();
  }

  /** Revoke one licence; false when it was already revoked (or does not exist). */
  async revokeOne(id: string, exec: Executor = db): Promise<boolean> {
    const r = await exec.updateTable("offline_downloads").set({ revoked_at: new Date() }).where("id", "=", id).where("revoked_at", "is", null).executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }
}

export const offlineDownloadRepo = new OfflineDownloadRepository();
