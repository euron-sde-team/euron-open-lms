/** Installed apps that receive push notifications. A token is unique across accounts. */
import { db, type Executor } from "../db/kysely";

export type PushDeviceRow = Awaited<ReturnType<PushDeviceRepository["upsert"]>>;

export class PushDeviceRepository {
  /** Insert, or take over the token (a device that changed hands moves to `user_id`). */
  upsert(row: { id: string; user_id: string; platform: "IOS" | "ANDROID"; token: string; app_version: string | null; locale: string | null }, exec: Executor = db) {
    return exec
      .insertInto("push_devices")
      .values(row)
      .onConflict((oc) => oc.column("token").doUpdateSet({ user_id: row.user_id, platform: row.platform, app_version: row.app_version, locale: row.locale, last_seen_at: new Date() }))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  listForUser(userId: string, exec: Executor = db) {
    return exec.selectFrom("push_devices").selectAll().where("user_id", "=", userId).orderBy("last_seen_at", "desc").execute();
  }

  /** Remove one device, only if `userId` owns it. */
  async deleteOwn(userId: string, token: string, exec: Executor = db): Promise<boolean> {
    const r = await exec.deleteFrom("push_devices").where("user_id", "=", userId).where("token", "=", token).executeTakeFirst();
    return Number(r.numDeletedRows) > 0;
  }

  deleteAllForUser(userId: string, exec: Executor = db) {
    return exec.deleteFrom("push_devices").where("user_id", "=", userId).execute();
  }

  /** Tokens the push provider says are dead (app uninstalled, token rotated). */
  async deleteTokens(tokens: string[], exec: Executor = db): Promise<void> {
    if (tokens.length) await exec.deleteFrom("push_devices").where("token", "in", tokens).execute();
  }
}

export const pushDeviceRepo = new PushDeviceRepository();
