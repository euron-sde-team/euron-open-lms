/**
 * Test harness: the app in-process, fast user creation, and course fixtures.
 *
 *   const ada = await createUser();                          // ACTIVE, email verified LEARNER
 *   const teacher = await createUser({ role: "INSTRUCTOR" });
 *   const course = await createCourse({ owner: teacher, accessMode: "PAID", price: { USD: 4900 } });
 *   await enroll(ada, course.id);                            // a GRANT enrollment
 *   await as(ada).get(`/api/learn/${course.slug}`).expect(200);
 */
import { beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { newId } from "../../src/core/ids";
import { db, initDbTypes } from "../../src/db/kysely";
import { hashPassword } from "../../src/security/passwords";
import { signAccessToken } from "../../src/security/tokens";
import { registerAllJobs } from "../../src/jobs";

registerAllJobs();
export const app = createApp();

// enum[] and citext[] columns parse as arrays only after this lookup, as at boot.
beforeAll(async () => {
  await initDbTypes();
});

export const PASSWORD = "correct-horse-battery-staple";
let passwordHash: string | null = null;

export interface TestUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  token: string;
}

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${process.pid.toString(36)}${counter}`.slice(0, 38);
}

export type Role = "LEARNER" | "INSTRUCTOR" | "SUPPORT" | "FINANCE" | "ADMIN";

/** Insert an ACTIVE, verified user directly, and mint an access token for them. */
export async function createUser(over: { role?: Role; status?: "ACTIVE" | "SUSPENDED" | "BANNED"; displayName?: string; createdAt?: Date; username?: string } = {}): Promise<TestUser> {
  passwordHash ??= await hashPassword(PASSWORD);
  const username = over.username ?? unique("u");
  const email = `${username}@example.test`;
  const row = await db
    .insertInto("users")
    .values({
      id: newId(),
      email,
      username,
      display_name: over.displayName ?? `User ${username}`,
      password_hash: passwordHash,
      role: over.role ?? "LEARNER",
      status: over.status ?? "ACTIVE",
      email_verified_at: new Date(),
      ...(over.createdAt ? { created_at: over.createdAt } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { id: row.id, email, username, displayName: row.display_name, token: signAccessToken(row.id, row.token_version) };
}

/** A supertest agent that sends the user's bearer token on every request. */
export function as(user: TestUser | null) {
  const agent = request(app);
  const auth = (r: request.Test) => (user ? r.set("Authorization", `Bearer ${user.token}`) : r);
  return {
    get: (url: string) => auth(agent.get(url)),
    post: (url: string) => auth(agent.post(url)),
    put: (url: string) => auth(agent.put(url)),
    patch: (url: string) => auth(agent.patch(url)),
    delete: (url: string) => auth(agent.delete(url)),
  };
}

export const anon = () => as(null);

// ─── Course fixtures ────────────────────────────────────────────────────────

export interface TestCourse {
  id: string;
  slug: string;
  sectionId: string;
  /** Item ids in curriculum order: by default one video, one article and one more video. */
  items: string[];
}

/**
 * A published course written straight to the database (authoring has its own tests).
 * Lectures are videos on the HLS provider unless `items` says otherwise.
 */
export async function createCourse(over: {
  owner?: TestUser;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  accessMode?: "FREE" | "PAID" | "SUBSCRIPTION_ONLY";
  includedInSubscription?: boolean;
  certificateEnabled?: boolean;
  price?: Record<string, number>;
  items?: { kind?: "VIDEO" | "ARTICLE" | "PDF"; title?: string; durationSeconds?: number; isPreview?: boolean }[];
} = {}): Promise<TestCourse> {
  const id = newId();
  const slug = unique("course-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const items = over.items ?? [{ kind: "VIDEO" }, { kind: "ARTICLE" }, { kind: "VIDEO" }];
  const sectionId = newId();
  const itemIds: string[] = [];
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("courses")
      .values({
        id,
        slug,
        title: `Course ${slug}`,
        description: "A course used by the integration tests.",
        status: over.status ?? "PUBLISHED",
        access_mode: over.accessMode ?? "PAID",
        included_in_subscription: over.includedInSubscription ?? true,
        certificate_enabled: over.certificateEnabled ?? true,
        published_at: (over.status ?? "PUBLISHED") === "PUBLISHED" ? new Date() : null,
        created_by: over.owner?.id ?? null,
      })
      .execute();
    if (over.owner) await trx.insertInto("course_staff").values({ course_id: id, user_id: over.owner.id, role: "OWNER" }).execute();
    await trx.insertInto("course_sections").values({ id: sectionId, course_id: id, title: "Getting started", position: 0 }).execute();
    let total = 0;
    for (const [i, it] of items.entries()) {
      const itemId = newId();
      const kind = it.kind ?? "VIDEO";
      const duration = it.durationSeconds ?? (kind === "VIDEO" ? 120 : 300);
      total += duration;
      await trx.insertInto("course_items").values({ id: itemId, course_id: id, section_id: sectionId, kind: "LECTURE", title: it.title ?? `Lesson ${i + 1}`, position: i, is_preview: it.isPreview ?? false, duration_seconds: duration }).execute();
      await trx
        .insertInto("lectures")
        .values({
          item_id: itemId,
          lecture_kind: kind,
          video_provider: kind === "VIDEO" ? "HLS" : null,
          video_ref: kind === "VIDEO" ? `https://media.example.test/${itemId}/master.m3u8` : null,
          body: kind === "ARTICLE" ? "# Reading\n\nSome text." : null,
        })
        .execute();
      itemIds.push(itemId);
    }
    await trx.updateTable("courses").set({ item_count: items.length, duration_seconds: total }).where("id", "=", id).execute();
    for (const [currency, amount] of Object.entries(over.price ?? (over.accessMode === "FREE" || over.accessMode === "SUBSCRIPTION_ONLY" ? {} : { USD: 4900 }))) {
      await trx.insertInto("prices").values({ id: newId(), sellable_type: "COURSE", sellable_id: id, currency, amount_minor: amount }).execute();
    }
  });
  return { id, slug, sectionId, items: itemIds };
}

/** Give a learner access the way an admin grant does (no order). */
export async function enroll(user: TestUser, courseId: string, over: { source?: "GRANT" | "FREE" | "PURCHASE" | "SUBSCRIPTION" | "BUNDLE"; validUntil?: Date | null; status?: "ACTIVE" | "REVOKED" } = {}): Promise<string> {
  const id = newId();
  await db
    .insertInto("enrollments")
    .values({ id, user_id: user.id, course_id: courseId, source: over.source ?? "GRANT", status: over.status ?? "ACTIVE", valid_until: over.validUntil ?? null })
    .execute();
  await db.updateTable("courses").set((eb) => ({ enrollment_count: eb("enrollment_count", "+", 1) })).where("id", "=", courseId).execute();
  return id;
}

/** An all-access plan with a monthly price, and optionally an ACTIVE subscription for `user`. */
export async function createPlan(over: { currency?: string; amountMinor?: number } = {}): Promise<{ id: string; slug: string; priceId: string }> {
  const id = newId();
  const slug = unique("plan-").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const priceId = newId();
  await db.insertInto("plans").values({ id, slug, name: `Plan ${slug}`, status: "ACTIVE" }).execute();
  await db.insertInto("prices").values({ id: priceId, sellable_type: "PLAN", sellable_id: id, currency: over.currency ?? "USD", amount_minor: over.amountMinor ?? 1900, interval: "MONTH" }).execute();
  return { id, slug, priceId };
}

export async function subscribe(user: TestUser, planId: string, over: { status?: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED"; periodEnd?: Date } = {}): Promise<string> {
  const id = newId();
  await db
    .insertInto("subscriptions")
    .values({
      id,
      user_id: user.id,
      plan_id: planId,
      gateway: "STRIPE",
      gateway_subscription_ref: `sub_test_${id}`,
      status: over.status ?? "ACTIVE",
      currency: "USD",
      amount_minor: 1900,
      interval: "MONTH",
      current_period_start: new Date(),
      current_period_end: over.periodEnd ?? new Date(Date.now() + 30 * 86_400_000),
    })
    .execute();
  return id;
}
