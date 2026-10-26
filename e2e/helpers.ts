/**
 * Shared helpers for the end-to-end suite. Setup goes through the real REST API (never
 * the database) so each test spends browser time only on the behaviour under test.
 *
 * Every simulated person gets their own client address (X-Forwarded-For, honoured by the
 * local stack's single trusted proxy hop), on API calls and on their browser's API calls,
 * so the per-IP budgets (sign-in, sign-up) apply per person the way they would for real
 * visitors instead of every test sharing one loopback budget.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

export const WEB = (process.env.E2E_BASE_URL || "http://localhost:3530").replace(/\/+$/, "");
export const API = (process.env.E2E_API_URL || "http://localhost:5026/api").replace(/\/+$/, "");
export const MAILPIT = (process.env.E2E_MAILPIT_URL || "http://localhost:8046").replace(/\/+$/, "");
export const STUBS = (process.env.E2E_STUBS_URL || "http://localhost:5119").replace(/\/+$/, "");

/** The demo password `make env` generated (E2E_DEMO_PASSWORD overrides). Never hardcoded. */
export function demoPassword(): string {
  if (process.env.E2E_DEMO_PASSWORD) return process.env.E2E_DEMO_PASSWORD;
  const file = path.join(__dirname, "..", "deploy", "compose", ".env");
  const line = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("LMS_DEMO_PASSWORD=")) : undefined;
  if (!line) throw new Error("No demo password: run `make env && make demo`, or set E2E_DEMO_PASSWORD");
  return line.slice("LMS_DEMO_PASSWORD=".length).trim().replace(/^["']|["']$/g, "");
}

/** Demo accounts (apps/api/src/demo/seed.ts). */
export const DEMO = {
  admin: "admin@example.com",
  support: "support@example.com",
  finance: "finance@example.com",
  maya: "maya.okafor@example.com",
  daniel: "daniel.reyes@example.com",
  priya: "priya.raman@example.com",
};

export interface TestUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  password: string;
  accessToken: string;
  /** The simulated client address this person uses. */
  ip: string;
}

const run = randomBytes(3).toString("hex");
let seq = 0;

/** A unique suffix for names, slugs and addresses (lowercase letters and digits). */
export function uniq(prefix = "e2e"): string {
  seq += 1;
  return `${prefix}${run}${seq}${randomBytes(2).toString("hex")}`;
}

// Addresses in 10.0.0.0/8: a random starting point per worker, then sequential, so no two
// simulated people in a run (or, in practice, in back-to-back runs) share a budget.
let nextIp = randomBytes(3).readUIntBE(0, 3) & 0xffffff;

/** A fresh client address for one simulated person. */
export function clientIp(): string {
  nextIp = (nextIp + 1) & 0xffffff;
  return `10.${(nextIp >> 16) & 255}.${(nextIp >> 8) & 255}.${nextIp & 255}`;
}

type Json = Record<string, unknown>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Calls the API as `who` (a token, or nobody), failing the test on an unexpected status. */
export async function call<T = Json>(
  request: APIRequestContext,
  method: Method,
  route: string,
  opts: { token?: string; ip?: string; data?: unknown; expect?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { "X-Forwarded-For": opts.ip ?? clientIp() };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const r = await request.fetch(`${API}${route}`, { method, headers, data: opts.data as never, maxRedirects: 0 });
  const text = await r.text();
  if (opts.expect !== undefined) expect(r.status(), `${method} ${route}: ${text}`).toBe(opts.expect);
  else expect(r.ok(), `${method} ${route} -> ${r.status()}: ${text}`).toBe(true);
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    return {} as T;
  }
}

/** Calls the API as a test user. */
export function as<T = Json>(request: APIRequestContext, user: Pick<TestUser, "accessToken" | "ip">, method: Method, route: string, data?: unknown, status?: number) {
  return call<T>(request, method, route, { token: user.accessToken, ip: user.ip, data, expect: status });
}

// ─── Mail ────────────────────────────────────────────────────────────────────

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Created: string;
}

/** The newest mail to `to` matching `subject`, polling Mailpit until it arrives. */
export async function waitForMail(request: APIRequestContext, to: string, subject: RegExp = /./, timeoutMs = 30_000): Promise<{ html: string; text: string; subject: string }> {
  const addr = to.toLowerCase();
  let found: { html: string; text: string; subject: string } | null = null;
  await expect
    .poll(
      async () => {
        const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${addr}"`)}&limit=20`);
        if (!r.ok()) return false;
        const list = ((await r.json()).messages ?? []) as MailSummary[];
        const hit = list.find((m) => m.To.some((t) => t.Address.toLowerCase() === addr) && subject.test(m.Subject));
        if (!hit) return false;
        const full = await (await request.get(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
        found = { html: full.HTML || "", text: full.Text || "", subject: hit.Subject };
        return true;
      },
      { timeout: timeoutMs, intervals: [250], message: `mail to ${to} matching ${subject}` },
    )
    .toBe(true);
  return found!;
}

/** The first link in a mail matching `pattern`, with HTML entities undone. */
export function linkIn(mail: { html: string; text: string }, pattern: RegExp): string {
  const m = `${mail.text}\n${mail.html}`.replace(/&amp;/g, "&").match(pattern);
  if (!m) throw new Error(`No link matching ${pattern} in the mail`);
  return m[0];
}

/** The verification link the API mailed to `email`. */
export async function verificationLink(request: APIRequestContext, email: string): Promise<string> {
  return linkIn(await waitForMail(request, email, /confirm|verify/i), /https?:\/\/[^\s"'<>]+\/verify-email\?token=[^\s"'<>]+/);
}

// ─── People ──────────────────────────────────────────────────────────────────

/** A fresh, verified learner: signs up through the API and confirms the mailed link. */
export async function newUser(request: APIRequestContext, opts: { displayName?: string; currency?: "USD" | "INR" } = {}): Promise<TestUser> {
  const username = uniq("u");
  const email = `${username}@example.com`;
  const password = `Pw-${randomBytes(9).toString("base64url")}`;
  const displayName = opts.displayName ?? `Tester ${username.slice(-6)}`;
  const ip = clientIp();
  const signup = await call<{ verificationRequired?: boolean }>(request, "POST", "/auth/signup", { ip, data: { email, username, displayName, password }, expect: 202 });
  expect(signup.verificationRequired).toBe(true);
  const token = decodeURIComponent(new URL(await verificationLink(request, email)).searchParams.get("token") ?? "");
  const auth = await call<{ accessToken: string; user: { id: string } }>(request, "POST", "/auth/verify-email", { ip, data: { token } });
  const user = { id: auth.user.id, email, username, displayName, password, accessToken: auth.accessToken, ip };
  if (opts.currency) await as(request, user, "PATCH", "/users/me", { preferredCurrency: opts.currency });
  return user;
}

const staffCache = new Map<string, Promise<TestUser>>();

/** Signs an existing account in through the API (demo users, or a fresh token). */
export async function apiLogin(request: APIRequestContext, login: string, password = demoPassword()): Promise<TestUser> {
  const ip = clientIp();
  const r = await call<{ accessToken: string; user: { id: string; email: string; username: string; displayName: string } }>(request, "POST", "/auth/login", { ip, data: { login, password } });
  return { id: r.user.id, email: r.user.email, username: r.user.username, displayName: r.user.displayName, password, accessToken: r.accessToken, ip };
}

/** A demo staff account, signed in once per worker (access tokens outlive a spec). */
export function staff(request: APIRequestContext, login: string): Promise<TestUser> {
  let p = staffCache.get(login);
  if (!p) {
    p = apiLogin(request, login);
    staffCache.set(login, p);
    p.catch(() => staffCache.delete(login));
  }
  return p;
}

/**
 * A browser context that presents itself from `ip` to the API (which keeps per-IP
 * budgets). Routed per request rather than set as an extra header on every request: an
 * extra header would also go to presigned uploads and the payment stubs.
 */
export async function newContext(browser: Browser, ip: string = clientIp()): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.route(`${WEB}/api/**`, (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
  return ctx;
}

/**
 * Signs in through the UI login form and waits until the form has sent the browser on
 * (the session is in place by then; not every destination has the avatar menu).
 */
export async function signIn(page: Page, user: Pick<TestUser, "email" | "password">, opts: { next?: string } = {}) {
  await page.goto(opts.next ? `/login?next=${encodeURIComponent(opts.next)}` : "/login");
  await page.locator("#login").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A new browser context (a device with its own address) for `user`, signed in through the UI. */
export async function pageFor(browser: Browser, user: TestUser, next?: string): Promise<Page> {
  const ctx = await newContext(browser, user.ip);
  const page = await ctx.newPage();
  await signIn(page, user, { next });
  return page;
}

export async function signOut(page: Page) {
  await page.getByTestId("avatar-menu").first().click();
  await page.getByTestId("sign-out").click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("avatar-menu")).toHaveCount(0);
}

// ─── Catalog lookups ─────────────────────────────────────────────────────────

export interface PublicItem {
  id: string;
  title: string;
  kind: "LECTURE" | "QUIZ" | "ASSIGNMENT";
  lectureKind: "VIDEO" | "ARTICLE" | "PDF" | null;
  isPreview: boolean;
}

export interface PublicCourse {
  id: string;
  slug: string;
  title: string;
  accessMode: string;
  sections: { id: string; title: string; items: PublicItem[] }[];
}

/** The public course page data (ids of the course and its items). */
export async function course(request: APIRequestContext, slug: string, viewer?: TestUser): Promise<PublicCourse> {
  return viewer ? as<PublicCourse>(request, viewer, "GET", `/catalog/courses/${slug}`) : call<PublicCourse>(request, "GET", `/catalog/courses/${slug}`);
}

export const itemsOf = (c: Pick<PublicCourse, "sections">) => c.sections.flatMap((s) => s.items);

/** An admin grant: enrolls `learner` without a payment. */
export async function grant(request: APIRequestContext, learner: TestUser, courseId: string) {
  const admin = await staff(request, DEMO.admin);
  return as(request, admin, "POST", `/admin/learners/${learner.id}/enrollments`, { courseId, note: "e2e grant" });
}

// ─── Authoring through the API ───────────────────────────────────────────────

/** Uploads a small PNG as `purpose` and returns the upload id. */
export async function uploadPng(request: APIRequestContext, user: TestUser, purpose = "COURSE_COVER"): Promise<string> {
  const bytes = pngBytes(64);
  const t = await as<{ uploadId: string; put: { url: string; method: string; headers: Record<string, string> } }>(request, user, "POST", "/media/uploads", { purpose, fileName: "cover.png", mimeType: "image/png", sizeBytes: bytes.length }, 201);
  const put = await request.fetch(t.put.url, { method: t.put.method, headers: t.put.headers, data: bytes });
  expect(put.ok(), `upload PUT ${put.status()}`).toBe(true);
  await as(request, user, "POST", `/media/uploads/${t.uploadId}/complete`, {});
  return t.uploadId;
}

export type ItemSpec =
  | { kind: "ARTICLE"; title: string; body?: string; preview?: boolean }
  | { kind: "QUIZ"; title: string; passPercent?: number; maxAttempts?: number | null; reveal?: "AFTER_SUBMIT" | "AFTER_PASS" | "NEVER"; questions: { prompt: string; options: [string, boolean][]; explanation?: string }[] }
  | { kind: "ASSIGNMENT"; title: string; instructions?: string; rubric?: { title: string; maxPoints: number }[] };

export interface BuiltCourse {
  id: string;
  slug: string;
  title: string;
  owner: TestUser;
  sections: { id: string; items: { id: string; title: string; kind: string }[] }[];
}

/**
 * A course built through the authoring API by `owner` (an instructor): cover, description,
 * sections and items, optional prices, published unless `publish: false`.
 */
export async function buildCourse(
  request: APIRequestContext,
  owner: TestUser,
  spec: { title?: string; access?: "FREE" | "PAID" | "SUBSCRIPTION_ONLY"; prices?: { currency: string; amountMinor: number }[]; sections: { title: string; items: ItemSpec[] }[]; publish?: boolean },
): Promise<BuiltCourse> {
  const title = spec.title ?? `E2E Course ${uniq("c").slice(-8)}`;
  const created = await as<{ id: string; slug: string }>(request, owner, "POST", "/admin/courses", { title }, 201);
  const id = created.id;
  const cover = await uploadPng(request, owner);
  await as(request, owner, "PATCH", `/admin/courses/${id}`, {
    subtitle: "A short course built by the end-to-end suite",
    description: "This course exists to exercise the platform end to end. It is short on purpose and safe to ignore.",
    outcomes: ["Finish a short course"],
    coverUploadId: cover,
    accessMode: spec.access ?? "FREE",
  });
  if (spec.prices) await as(request, owner, "PUT", `/admin/courses/${id}/prices`, { prices: spec.prices });
  const sections: BuiltCourse["sections"] = [];
  for (const s of spec.sections) {
    const section = await as<{ id: string }>(request, owner, "POST", `/admin/courses/${id}/sections`, { title: s.title }, 201);
    const items: { id: string; title: string; kind: string }[] = [];
    for (const it of s.items) {
      if (it.kind === "ARTICLE") {
        const item = await as<{ id: string }>(request, owner, "POST", `/admin/courses/${id}/items`, { sectionId: section.id, kind: "LECTURE", lectureKind: "ARTICLE", title: it.title }, 201);
        await as(request, owner, "PATCH", `/admin/courses/${id}/items/${item.id}`, { isPreview: !!it.preview, durationSeconds: 120, lecture: { body: it.body ?? `## ${it.title}\n\nA short article for the end-to-end suite.` } });
        items.push({ id: item.id, title: it.title, kind: "ARTICLE" });
      } else if (it.kind === "QUIZ") {
        const item = await as<{ id: string }>(request, owner, "POST", `/admin/courses/${id}/items`, { sectionId: section.id, kind: "QUIZ", title: it.title }, 201);
        const qids: string[] = [];
        for (const q of it.questions) {
          const created = await as<{ id: string }>(request, owner, "POST", `/admin/courses/${id}/questions`, { kind: "SINGLE", prompt: q.prompt, explanation: q.explanation ?? null, options: q.options.map(([text, correct]) => ({ text, correct })) }, 201);
          qids.push(created.id);
        }
        await as(request, owner, "PATCH", `/admin/courses/${id}/items/${item.id}`, { quiz: { selection: "FIXED", passPercent: it.passPercent ?? 50, maxAttempts: it.maxAttempts === undefined ? 3 : it.maxAttempts, reveal: it.reveal ?? "AFTER_SUBMIT", shuffleQuestions: false, shuffleOptions: false } });
        await as(request, owner, "PUT", `/admin/courses/${id}/items/${item.id}/questions`, { questionIds: qids });
        items.push({ id: item.id, title: it.title, kind: "QUIZ" });
      } else {
        const item = await as<{ id: string }>(request, owner, "POST", `/admin/courses/${id}/items`, { sectionId: section.id, kind: "ASSIGNMENT", title: it.title }, 201);
        await as(request, owner, "PATCH", `/admin/courses/${id}/items/${item.id}`, {
          assignment: { instructions: it.instructions ?? "Build something small and share a link to it.", rubric: it.rubric ?? [{ title: "Quality", maxPoints: 10 }], acceptText: true, acceptUrl: true, acceptFiles: false },
        });
        items.push({ id: item.id, title: it.title, kind: "ASSIGNMENT" });
      }
    }
    sections.push({ id: section.id, items });
  }
  if (spec.publish !== false) await as(request, owner, "POST", `/admin/courses/${id}/publish`, {});
  const final = await as<{ slug: string }>(request, owner, "GET", `/admin/courses/${id}`);
  return { id, slug: final.slug, title, owner, sections };
}

/** Archives a course the suite built, so test courses do not pile up in the public catalog. */
export async function archiveCourse(request: APIRequestContext, owner: TestUser, courseId: string) {
  await as(request, owner, "POST", `/admin/courses/${courseId}/archive`, {});
}

// ─── Checkout through the stubs ──────────────────────────────────────────────

/** Buys `item` for `buyer` through Stripe's stub with the API alone, returning the paid order. */
export async function buyWithStripe(request: APIRequestContext, buyer: TestUser, item: { type: "COURSE" | "BUNDLE" | "PLAN"; id: string; interval?: "MONTH" | "YEAR" }) {
  const handoff = await as<{ type: string; orderId: string; url: string }>(request, buyer, "POST", "/checkout/start", { item, currency: "USD", billing: { name: buyer.displayName, country: "US" }, idempotencyKey: uniq("idem") });
  expect(handoff.type).toBe("REDIRECT");
  const pay = await request.fetch(`${handoff.url.replace(/\/+$/, "")}/pay`, { method: "POST", headers: { Accept: "application/json" }, maxRedirects: 0 });
  expect(pay.ok(), `stub pay ${pay.status()}`).toBe(true);
  let order: { id: string; status: string; number: string } = { id: handoff.orderId, status: "PENDING", number: "" };
  await expect
    .poll(async () => {
      order = await as(request, buyer, "GET", `/checkout/orders/${handoff.orderId}?sync=1`);
      return order.status;
    })
    .toBe("PAID");
  return order;
}

// ─── Video ───────────────────────────────────────────────────────────────────

/**
 * Makes the player's <video> play (autoplay may or may not have started it; the suite's
 * browser allows playback without a gesture) and waits until the playhead moves past `atLeast`.
 */
export async function playVideo(scope: Page | Locator, atLeast = 0.2) {
  const video = scope.getByTestId("video-player").locator("video");
  await expect(video).toBeAttached();
  await expect
    .poll(
      () =>
        video.evaluate((v: HTMLVideoElement, min) => {
          if (v.paused && !v.ended) void v.play().catch(() => undefined);
          return v.currentTime > min;
        }, atLeast),
      { timeout: 20_000, intervals: [250] },
    )
    .toBe(true);
  return video;
}

// ─── Misc ────────────────────────────────────────────────────────────────────

/** A small, valid PNG (a solid colour square), built in memory: no binary fixture to commit. */
export function pngBytes(size = 16, rgb: [number, number, number] = [37, 99, 235]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
