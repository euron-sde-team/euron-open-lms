/**
 * Creating and reading notifications. Every module calls `notify` inside its
 * transaction with its Effects buffer; the email (when the learner wants it) is queued
 * after commit, so a rolled-back write never mails anyone.
 *
 * Rules applied here so callers cannot forget them:
 *   - never notify yourself;
 *   - collapse duplicates: the same (recipient, actor, type, entity) within an hour
 *     updates the existing row instead of stacking a new one;
 *   - email follows the learner's per-category switches (EMAIL_CATEGORY below), except
 *     the categories that must always arrive (receipts, refunds, account security);
 *   - push (when PUSH_PROVIDER is set) follows the push switches by the same map, in its
 *     own job (services/push.service.ts), so a slow email never delays a push.
 */
import type { EmailCategory, Notification, NotificationCounts, NotificationType } from "@open-lms/types";
import { sql } from "kysely";
import type { Actor } from "../core/context";
import { pushEnabled } from "../core/config";
import type { Effects } from "../core/effects";
import { notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import { presentNotifications } from "../presenters/notification.presenter";
import { decodeTime, timePage, type Paged } from "../repositories/keyset";
import { notificationRepo } from "../repositories/notification.repository";

export interface NotifyInput {
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  entityType: string;
  entityId: string;
  snippet?: string | null;
  /** Extras for building the link (courseSlug, itemId, threadId, serial...). */
  data?: Record<string, unknown>;
}

/** Which email switch governs a type. null: always emailed (money and access changes). */
export const EMAIL_CATEGORY: Record<NotificationType, EmailCategory | null> = {
  ORDER_PAID: null,
  ORDER_FAILED: "BILLING_REMINDERS",
  REFUND_ISSUED: null,
  ENROLLMENT_GRANTED: null,
  ENROLLMENT_REVOKED: null,
  SUBMISSION_REVIEWED: "LEARNING",
  CERTIFICATE_ISSUED: "LEARNING",
  SUBSCRIPTION_RENEWED: "BILLING_REMINDERS",
  SUBSCRIPTION_PAYMENT_FAILED: null,
  SUBSCRIPTION_CANCELED: null,
  QA_REPLY: "COMMUNITY",
  QA_ACCEPTED: "COMMUNITY",
  REVIEW_REPLY: "COMMUNITY",
  COURSE_UPDATED: "PRODUCT_UPDATES",
};

/**
 * Types with their own dedicated email (a receipt with the invoice, a refund notice),
 * sent by the billing jobs: the generic notification email skips them, so nobody gets
 * two messages about one payment.
 */
export const OWN_EMAIL: ReadonlySet<NotificationType> = new Set(["ORDER_PAID", "REFUND_ISSUED"]);

/** Where a notification should take the user, from its type and data. */
export function hrefFor(n: { type: NotificationType; entity_type: string; entity_id: string; data: unknown }): string {
  const d = (n.data ?? {}) as Record<string, string | undefined>;
  switch (n.type) {
    case "ORDER_PAID":
    case "ORDER_FAILED":
    case "REFUND_ISSUED":
      return `/account/orders/${d.orderId ?? n.entity_id}`;
    case "ENROLLMENT_GRANTED":
      return d.courseSlug ? `/learn/${d.courseSlug}` : "/my-learning";
    case "ENROLLMENT_REVOKED":
      return d.courseSlug ? `/courses/${d.courseSlug}` : "/my-learning";
    case "SUBMISSION_REVIEWED":
      return d.courseSlug && d.itemId ? `/learn/${d.courseSlug}/${d.itemId}` : "/my-learning";
    case "CERTIFICATE_ISSUED":
      return d.serial ? `/certificates/${d.serial}` : "/my-learning?tab=certificates";
    case "SUBSCRIPTION_RENEWED":
    case "SUBSCRIPTION_PAYMENT_FAILED":
    case "SUBSCRIPTION_CANCELED":
      return "/account/subscription";
    case "QA_REPLY":
    case "QA_ACCEPTED":
      return d.courseSlug ? `/learn/${d.courseSlug}${d.itemId ? `/${d.itemId}` : ""}?tab=qa&thread=${d.threadId ?? n.entity_id}` : "/notifications";
    case "REVIEW_REPLY":
    case "COURSE_UPDATED":
      return d.courseSlug ? `/courses/${d.courseSlug}` : "/notifications";
    default:
      return "/notifications";
  }
}

export async function notify(input: NotifyInput, fx: Effects, exec: Executor = db): Promise<void> {
  if (input.actorId && input.actorId === input.recipientId) return;

  const snippet = input.snippet ? input.snippet.replace(/\s+/g, " ").trim().slice(0, 200) : null;
  const data = JSON.stringify(input.data ?? {});

  const recent = await exec
    .selectFrom("notifications")
    .select("id")
    .where("recipient_id", "=", input.recipientId)
    .where("type", "=", input.type)
    .where("entity_id", "=", input.entityId)
    .where((eb) => (input.actorId ? eb("actor_id", "=", input.actorId) : eb("actor_id", "is", null)))
    .where("created_at", ">", sql<Date>`now() - interval '1 hour'`)
    .executeTakeFirst();

  const row = recent
    ? await exec.updateTable("notifications").set({ read_at: null, snippet, data, created_at: new Date() }).where("id", "=", recent.id).returning("id").executeTakeFirstOrThrow()
    : await exec
        .insertInto("notifications")
        .values({ id: newId(), recipient_id: input.recipientId, actor_id: input.actorId, type: input.type, entity_type: input.entityType, entity_id: input.entityId, snippet, data })
        .returning("id")
        .executeTakeFirstOrThrow();

  fx.job("notify.email", { notificationId: row.id });
  if (pushEnabled()) fx.job("notify.push", { notificationId: row.id });
}

export async function countsFor(userId: string, exec: Executor = db): Promise<NotificationCounts> {
  const r = await exec
    .selectFrom("notifications")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("recipient_id", "=", userId)
    .where("read_at", "is", null)
    .executeTakeFirstOrThrow();
  return { notifications: Number(r.n) };
}

// ─── Reading the inbox ──────────────────────────────────────────────────────

export async function listNotifications(actor: Actor, q: { unreadOnly: boolean; cursor?: string; limit: number }): Promise<Paged<Notification>> {
  const page = timePage(await notificationRepo.list(actor.id, { unreadOnly: q.unreadOnly, cursor: decodeTime(q.cursor), limit: q.limit }), q.limit);
  return { items: await presentNotifications(page.items), nextCursor: page.nextCursor };
}

export async function markRead(actor: Actor, id: string): Promise<void> {
  if (!(await notificationRepo.markRead(actor.id, id))) throw notFound("Notification not found");
}

export async function markAllRead(actor: Actor): Promise<void> {
  await notificationRepo.markAllRead(actor.id);
}
