/**
 * Maintenance jobs and notification email: preferences, send-once, the purge grace
 * period, counter reconciliation and timed suspensions. Handlers run inline
 * (JOBS_MODE=inline) and are also called directly, as the scheduler would.
 */
import type { NotificationType } from "@open-lms/types";
import { describe, expect, test } from "vitest";
import { withTransaction } from "../../src/core/effects";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { clearSentMail, sentMail } from "../../src/integrations/mail/mailer";
import { notificationCopy } from "../../src/integrations/mail/admin-templates";
import { emailNotifications, liftSuspensions, purgeAccounts, reconcileCounters } from "../../src/jobs/maintenance.jobs";
import { getHandler } from "../../src/jobs/registry";
import { DELETION_GRACE_DAYS } from "../../src/services/account.service";
import { notify } from "../../src/services/notification.service";
import { anon, as, createCourse, createPlan, createUser, enroll, PASSWORD, subscribe, type TestUser } from "./harness";

async function notifyOf(user: TestUser, type: NotificationType, snippet = "Data Science 101", data: Record<string, unknown> = { courseSlug: "data-science-101" }) {
  await withTransaction((trx, fx) => notify({ recipientId: user.id, actorId: null, type, entityType: "course", entityId: newId(), snippet, data }, fx, trx));
  return db.selectFrom("notifications").select(["id", "emailed_at"]).where("recipient_id", "=", user.id).where("type", "=", type).orderBy("created_at", "desc").executeTakeFirstOrThrow();
}

const mailTo = (u: TestUser) => sentMail().filter((m) => m.to === u.email);

describe("notify.email", () => {
  test("sends once, with the type's words and a link into the web app", async () => {
    const u = await createUser();
    clearSentMail();
    const n = await notifyOf(u, "CERTIFICATE_ISSUED", "Data Science 101", { serial: "LMS-AAAA-BBBB-CC" });
    expect(n.emailed_at).not.toBeNull();
    const mails = mailTo(u);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe(notificationCopy("CERTIFICATE_ISSUED", null, "x").title);
    expect(mails[0]!.text).toContain("http://localhost:3530/certificates/LMS-AAAA-BBBB-CC");
    expect(mails[0]!.html).toContain("&quot;Data Science 101&quot;");
    // The sweep and a retried job find nothing left to send.
    await emailNotifications();
    await emailNotifications(n.id);
    await getHandler("notify.email")!({ notificationId: n.id });
    expect(mailTo(u)).toHaveLength(1);
  });

  test("a category switched off is not emailed; receipts and access changes always are", async () => {
    const u = await createUser();
    await as(u).patch("/api/users/me").send({ emailPreferences: { LEARNING: false, COMMUNITY: false, BILLING_REMINDERS: false, PRODUCT_UPDATES: false } }).expect(200);
    clearSentMail();
    const quiet = await notifyOf(u, "SUBMISSION_REVIEWED");
    const qa = await notifyOf(u, "QA_REPLY");
    expect(quiet.emailed_at).toBeNull();
    expect(qa.emailed_at).toBeNull();
    expect(mailTo(u)).toHaveLength(0);
    // Access changes always email; receipts are left to their dedicated receipt email.
    const paid = await notifyOf(u, "ORDER_PAID", "Data Science 101", { orderId: newId() });
    const revoked = await notifyOf(u, "ENROLLMENT_REVOKED", "Data Science 101");
    const granted = await notifyOf(u, "ENROLLMENT_GRANTED");
    expect(paid.emailed_at).toBeNull();
    expect(revoked.emailed_at).not.toBeNull();
    expect(granted.emailed_at).not.toBeNull();
    expect(mailTo(u).map((m) => m.subject)).toEqual([notificationCopy("ENROLLMENT_REVOKED", "Data Science 101", "x").title, notificationCopy("ENROLLMENT_GRANTED", "Data Science 101", "x").title]);
    // The sweep does not pick the switched-off ones up either.
    await emailNotifications();
    expect(mailTo(u)).toHaveLength(2);
    // Switching a category back on applies to new notifications.
    await as(u).patch("/api/users/me").send({ emailPreferences: { LEARNING: true } }).expect(200);
    expect((await notifyOf(u, "CERTIFICATE_ISSUED")).emailed_at).not.toBeNull();
  });

  test("accounts that are not active and verified get no email", async () => {
    const banned = await createUser({ status: "BANNED" });
    const unverified = await createUser();
    await db.updateTable("users").set({ email_verified_at: null }).where("id", "=", unverified.id).execute();
    clearSentMail();
    expect((await notifyOf(banned, "ENROLLMENT_GRANTED")).emailed_at).toBeNull();
    expect((await notifyOf(unverified, "ENROLLMENT_GRANTED")).emailed_at).toBeNull();
    expect(sentMail()).toHaveLength(0);
  });

  test("the sweep emails what a lost job missed, oldest first, and skips anything older than its window", async () => {
    const u = await createUser();
    const fresh = newId();
    const stale = newId();
    await db
      .insertInto("notifications")
      .values([
        { id: fresh, recipient_id: u.id, type: "ENROLLMENT_REVOKED", entity_type: "course", entity_id: newId(), data: JSON.stringify({}) },
        { id: stale, recipient_id: u.id, type: "ENROLLMENT_REVOKED", entity_type: "course", entity_id: newId(), data: JSON.stringify({}), created_at: new Date(Date.now() - 5 * 86_400_000) },
      ])
      .execute();
    clearSentMail();
    expect(await emailNotifications()).toBeGreaterThanOrEqual(1);
    expect(mailTo(u)).toHaveLength(1);
    const rows = await db.selectFrom("notifications").select(["id", "emailed_at"]).where("id", "in", [fresh, stale]).execute();
    expect(rows.find((r) => r.id === fresh)!.emailed_at).not.toBeNull();
    expect(rows.find((r) => r.id === stale)!.emailed_at).toBeNull();
  });

  test("every notification type has its own words", () => {
    const types: NotificationType[] = ["ORDER_PAID", "ORDER_FAILED", "REFUND_ISSUED", "ENROLLMENT_GRANTED", "ENROLLMENT_REVOKED", "SUBMISSION_REVIEWED", "CERTIFICATE_ISSUED", "SUBSCRIPTION_RENEWED", "SUBSCRIPTION_PAYMENT_FAILED", "SUBSCRIPTION_CANCELED", "QA_REPLY", "QA_ACCEPTED", "REVIEW_REPLY", "COURSE_UPDATED"];
    const titles = new Set(types.map((t) => notificationCopy(t, null, "Academy").title));
    expect(titles.size).toBe(types.length);
    for (const t of types) {
      const c = notificationCopy(t, "A <b>course</b>", "Academy");
      expect(c.body.length, t).toBeGreaterThan(10);
      expect(c.cta.length, t).toBeGreaterThan(2);
    }
  });
});

describe("maintenance.purge-accounts", () => {
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

  test("erases after the grace period, not before, and not while a subscription is live", async () => {
    const due = await createUser();
    const early = await createUser();
    const paying = await createUser();
    const course = await createCourse();
    await enroll(due, course.id);
    const plan = await createPlan();
    await subscribe(paying, plan.id);
    await db.updateTable("users").set({ deletion_requested_at: ago(DELETION_GRACE_DAYS + 1) }).where("id", "in", [due.id, paying.id]).execute();
    await db.updateTable("users").set({ deletion_requested_at: ago(DELETION_GRACE_DAYS - 1) }).where("id", "=", early.id).execute();

    await getHandler("maintenance.purge-accounts")!({});
    const rows = await db.selectFrom("users").select(["id", "status", "display_name", "deletion_requested_at"]).where("id", "in", [due.id, early.id, paying.id]).execute();
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(due.id)).toMatchObject({ status: "DEACTIVATED", display_name: "Deleted user", deletion_requested_at: null });
    expect(by(early.id).status).toBe("ACTIVE");
    expect(by(paying.id).status).toBe("ACTIVE");
    // The enrollment (a learning record) stays with the anonymised row.
    expect(await db.selectFrom("enrollments").select("id").where("user_id", "=", due.id).execute()).toHaveLength(1);
    const audit = await db.selectFrom("audit_log").select(["actor_id"]).where("action", "=", "user.purged").where("entity_id", "=", due.id).execute();
    expect(audit).toEqual([{ actor_id: null }]);
    // Running again changes nothing.
    expect(await purgeAccounts()).toBe(0);
  });

  test("signing in during the grace period keeps the account", async () => {
    const u = await createUser();
    await db.updateTable("users").set({ deletion_requested_at: ago(DELETION_GRACE_DAYS - 2) }).where("id", "=", u.id).execute();
    await anon().post("/api/auth/login").send({ login: u.email, password: PASSWORD }).expect(200);
    expect((await db.selectFrom("users").select("deletion_requested_at").where("id", "=", u.id).executeTakeFirstOrThrow()).deletion_requested_at).toBeNull();
    await purgeAccounts();
    expect((await db.selectFrom("users").select("status").where("id", "=", u.id).executeTakeFirstOrThrow()).status).toBe("ACTIVE");
  });
});

describe("maintenance.reconcile-counters", () => {
  test("fixes drifted course and thread counters and leaves correct rows alone", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const course = await createCourse({ owner: teacher, items: [{ kind: "VIDEO", durationSeconds: 100 }, { kind: "ARTICLE", durationSeconds: 50 }] });
    const [a, b, c] = [await createUser(), await createUser(), await createUser()];
    for (const u of [a, b]) await enroll(u, course.id);
    await db.insertInto("reviews").values([
      { id: newId(), course_id: course.id, user_id: a.id, rating: 5 },
      { id: newId(), course_id: course.id, user_id: b.id, rating: 3 },
      { id: newId(), course_id: course.id, user_id: c.id, rating: 1, status: "HIDDEN" },
    ]).execute();
    const thread = newId();
    await db.insertInto("qa_threads").values({ id: thread, course_id: course.id, author_id: a.id, title: "A question here", body: "Why?" }).execute();
    await db.insertInto("qa_replies").values([
      { id: newId(), thread_id: thread, author_id: b.id, body: "Because." },
      { id: newId(), thread_id: thread, author_id: c.id, body: "Spam", status: "HIDDEN" },
    ]).execute();
    // Drift everything.
    await db.updateTable("courses").set({ enrollment_count: 99, rating_count: 0, rating_sum: 0, item_count: 7, duration_seconds: 1 }).where("id", "=", course.id).execute();
    await db.updateTable("qa_threads").set({ reply_count: 5 }).where("id", "=", thread).execute();
    const untouched = await createCourse();
    const before = await db.selectFrom("courses").select("updated_at").where("id", "=", untouched.id).executeTakeFirstOrThrow();

    const fixed = await reconcileCounters();
    expect(fixed.courses).toBeGreaterThanOrEqual(1);
    const row = await db.selectFrom("courses").select(["enrollment_count", "rating_count", "rating_sum", "item_count", "duration_seconds"]).where("id", "=", course.id).executeTakeFirstOrThrow();
    expect(row).toEqual({ enrollment_count: 2, rating_count: 2, rating_sum: 8, item_count: 2, duration_seconds: 150 });
    expect((await db.selectFrom("qa_threads").select("reply_count").where("id", "=", thread).executeTakeFirstOrThrow()).reply_count).toBe(1);
    expect((await db.selectFrom("courses").select("updated_at").where("id", "=", untouched.id).executeTakeFirstOrThrow()).updated_at).toEqual(before.updated_at);
    // A second pass finds nothing to fix.
    expect(await reconcileCounters()).toEqual({ courses: 0, threads: 0 });
  });
});

describe("maintenance.lift-suspensions", () => {
  test("ends suspensions whose time is up, keeps the rest", async () => {
    const over = await createUser({ status: "SUSPENDED" });
    const running = await createUser({ status: "SUSPENDED" });
    await db.updateTable("users").set({ suspended_until: new Date(Date.now() - 1000) }).where("id", "=", over.id).execute();
    await db.updateTable("users").set({ suspended_until: new Date(Date.now() + 86_400_000) }).where("id", "=", running.id).execute();
    expect(await liftSuspensions()).toBeGreaterThanOrEqual(1);
    const rows = await db.selectFrom("users").select(["id", "status", "suspended_until"]).where("id", "in", [over.id, running.id]).execute();
    expect(rows.find((r) => r.id === over.id)).toMatchObject({ status: "ACTIVE", suspended_until: null });
    expect(rows.find((r) => r.id === running.id)!.status).toBe("SUSPENDED");
    await as(over).patch("/api/users/me").send({ displayName: "Back Again" }).expect(200);
  });
});
