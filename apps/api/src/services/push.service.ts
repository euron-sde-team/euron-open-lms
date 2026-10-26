/**
 * Pushing one notification to the recipient's devices (the notify.push job, queued by
 * notification.service.ts notify() after commit when PUSH_PROVIDER is not none).
 *
 *   - follows the learner's push switches (users.push_preferences, PUSH_DEFAULTS for keys
 *     never set), by the same category map as email (EMAIL_CATEGORY); types without a
 *     category (receipts, refunds, access changes) are always pushed;
 *   - only ACTIVE accounts, only notifications from the last three days;
 *   - claimed once (pushed_at set where it is still NULL) before anything is sent, so a
 *     retried job or two workers never push twice;
 *   - the words are the email's (notificationCopy) and `data.url` is the same app path
 *     the inbox links to (hrefFor), so web, email and push agree on where to go;
 *   - a token the provider reports dead is deleted; other failures are logged.
 */
import type { NotificationType, PushData } from "@open-lms/types";
import { sql } from "kysely";
import { captureError, logger } from "../core/logger";
import { db } from "../db/kysely";
import { notificationCopy } from "../integrations/mail/admin-templates";
import { pushProvider } from "../integrations/push";
import { pushPreferences } from "../presenters/user.presenter";
import { pushDeviceRepo } from "../repositories/push-device.repository";
import { EMAIL_CATEGORY, hrefFor } from "./notification.service";
import { academyName } from "./settings.service";

const PUSH_WINDOW = "3 days";

/** Push one notification. Returns how many devices accepted it. */
export async function pushNotification(notificationId: string): Promise<number> {
  const provider = pushProvider();
  if (!provider) return 0;
  const n = await db
    .selectFrom("notifications as n")
    .innerJoin("users as u", "u.id", "n.recipient_id")
    .select(["n.id", "n.type", "n.entity_type", "n.entity_id", "n.data", "n.snippet", "n.recipient_id", "u.push_preferences"])
    .where("n.id", "=", notificationId)
    .where("n.pushed_at", "is", null)
    .where("u.status", "=", "ACTIVE")
    .where("n.created_at", ">", sql<Date>`now() - ${sql.raw(`interval '${PUSH_WINDOW}'`)}`)
    .executeTakeFirst();
  if (!n) return 0;
  const category = EMAIL_CATEGORY[n.type as NotificationType];
  if (category && !pushPreferences(n.push_preferences)[category]) return 0;
  const devices = await pushDeviceRepo.listForUser(n.recipient_id);
  if (!devices.length) return 0;
  const claimed = await db.updateTable("notifications").set({ pushed_at: new Date() }).where("id", "=", n.id).where("pushed_at", "is", null).executeTakeFirst();
  if (Number(claimed.numUpdatedRows) === 0) return 0;

  const copy = notificationCopy(n.type, n.snippet, await academyName());
  const data: PushData = { type: n.type, url: hrefFor(n), notificationId: n.id };
  const dead: string[] = [];
  let sent = 0;
  for (const d of devices) {
    try {
      const r = await provider.send({ token: d.token, platform: d.platform as "IOS" | "ANDROID", title: copy.title, body: copy.body, data: { ...data } });
      if (r.ok) sent += 1;
      else if (r.dead) dead.push(d.token);
      else logger.warn({ notificationId: n.id, deviceId: d.id, error: r.error }, "push not delivered");
    } catch (err) {
      captureError(err, { where: "push.send", notificationId: n.id, deviceId: d.id });
    }
  }
  await pushDeviceRepo.deleteTokens(dead);
  return sent;
}
