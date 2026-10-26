/** Reading the notification inbox. Creating notifications is services/notification.service.ts notify(). */
import { db, type Executor } from "../db/kysely";
import { atKey, olderThan, type TimeKey } from "./keyset";

export class NotificationRepository {
  list(userId: string, opts: { unreadOnly: boolean; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec
      .selectFrom("notifications as n")
      .selectAll("n")
      .select(atKey("n.created_at"))
      .where("n.recipient_id", "=", userId);
    if (opts.unreadOnly) q = q.where("n.read_at", "is", null);
    return q.where(olderThan("n.created_at", "n.id", opts.cursor)).orderBy("n.created_at", "desc").orderBy("n.id", "desc").limit(opts.limit + 1).execute();
  }

  async markRead(userId: string, id: string, exec: Executor = db): Promise<boolean> {
    const own = await exec.selectFrom("notifications").select("id").where("id", "=", id).where("recipient_id", "=", userId).executeTakeFirst();
    if (!own) return false;
    await exec.updateTable("notifications").set({ read_at: new Date() }).where("id", "=", id).where("read_at", "is", null).execute();
    return true;
  }

  markAllRead(userId: string, exec: Executor = db) {
    return exec.updateTable("notifications").set({ read_at: new Date() }).where("recipient_id", "=", userId).where("read_at", "is", null).execute();
  }
}

export const notificationRepo = new NotificationRepository();
