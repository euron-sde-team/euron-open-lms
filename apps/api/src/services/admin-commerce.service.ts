/**
 * /api/admin/commerce: orders and refunds, subscriptions, plans, bundles, coupons and
 * the orders CSV. Areas (domain/admin-permissions.ts):
 *   orders    ADMIN, FINANCE, SUPPORT (read). Refunds and subscription cancels need
 *             canRefund (ADMIN, FINANCE): SUPPORT may look an order up, never move money.
 *   plans     plans and bundles (ADMIN, FINANCE)
 *   coupons   ADMIN, FINANCE
 * Every write is audited in the same transaction.
 */
import type { AdminBundle, AdminCoupon, AdminOrderDetail, AdminOrderRow, AdminPlan, AdminPrice, AdminSubscriptionRow, CouponScope, OrderStatus, Page, SellableType, SubscriptionStatus } from "@open-lms/types";
import { requireArea, type Actor } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import type { Executor } from "../db/kysely";
import type { Gateway } from "../db/types";
import { canRefund } from "../domain/admin-permissions";
import { formatMinor } from "../domain/pricing";
import { presentAdminBundles } from "../presenters/bundle-admin.presenter";
import { presentCoupons } from "../presenters/coupon.presenter";
import { presentAdminDetail, presentAdminRows } from "../presenters/order.presenter";
import { presentAdminPlans, toAdminPrice } from "../presenters/plan.presenter";
import { presentAdminSubscriptions } from "../presenters/subscription.presenter";
import { bundleAdminRepo } from "../repositories/bundle-admin.repository";
import { couponRepo } from "../repositories/coupon.repository";
import { decodeTime, timePage } from "../repositories/keyset";
import { orderRepo } from "../repositories/order.repository";
import { planRepo, type WantedPrice } from "../repositories/plan.repository";
import { subscriptionRepo } from "../repositories/subscription.repository";
import { audit } from "./audit.service";
import { claimSingle } from "./media-attach.service";
import { requestRefund, type RefundInput } from "./refund.service";
import { getSettings } from "./settings.service";
import { cancelSubscription } from "./subscription.service";

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

function requireMoneyMover(actor: Actor): void {
  if (!canRefund(actor.role)) throw forbidden("Only finance staff and admins can do that", "FORBIDDEN_ROLE");
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export async function searchOrders(actor: Actor, q: { q?: string; status?: OrderStatus; gateway?: Gateway; cursor?: string; limit?: number }): Promise<Page<AdminOrderRow>> {
  requireArea(actor, "orders");
  const limit = q.limit ?? 20;
  const page = timePage(await orderRepo.adminSearch({ q: q.q, status: q.status, gateway: q.gateway, cursor: decodeTime(q.cursor), limit }), limit);
  return { items: await presentAdminRows(page.items), nextCursor: page.nextCursor };
}

export async function orderDetail(actor: Actor, id: string): Promise<AdminOrderDetail> {
  requireArea(actor, "orders");
  const order = await orderRepo.byId(id);
  if (!order) throw notFound("Order not found");
  return presentAdminDetail(order);
}

export async function refundOrder(actor: Actor, id: string, input: RefundInput, ip: string | null): Promise<AdminOrderDetail> {
  requireArea(actor, "orders");
  requireMoneyMover(actor);
  await requestRefund(actor, id, input, ip);
  return orderDetail(actor, id);
}

// ─── Subscriptions ──────────────────────────────────────────────────────────

export async function listSubscriptions(actor: Actor, q: { status?: SubscriptionStatus; cursor?: string; limit?: number }): Promise<Page<AdminSubscriptionRow>> {
  requireArea(actor, "orders");
  const limit = q.limit ?? 20;
  const page = timePage(await subscriptionRepo.adminList({ status: q.status, cursor: decodeTime(q.cursor), limit }), limit);
  return { items: await presentAdminSubscriptions(page.items), nextCursor: page.nextCursor };
}

export async function cancelSubscriptionAdmin(actor: Actor, id: string, atPeriodEnd: boolean, ip: string | null): Promise<AdminSubscriptionRow> {
  requireArea(actor, "orders");
  requireMoneyMover(actor);
  const sub = await subscriptionRepo.byId(id);
  if (!sub) throw notFound("Subscription not found");
  await cancelSubscription(sub, actor, { atPeriodEnd, ip });
  return (await presentAdminSubscriptions([(await subscriptionRepo.byId(id))!]))[0] as AdminSubscriptionRow;
}

// ─── Prices (plans and bundles) ─────────────────────────────────────────────

async function validatePrices(wanted: WantedPrice[], recurring: boolean): Promise<void> {
  const settings = await getSettings();
  const enabled = new Set([settings.currencies.default, ...settings.currencies.enabled]);
  const seen = new Set<string>();
  for (const p of wanted) {
    if (!enabled.has(p.currency)) throw badRequest(`${p.currency} is not an enabled currency`, "CURRENCY_NOT_ENABLED");
    if (recurring !== (p.interval !== null)) throw badRequest(recurring ? "Plan prices need an interval" : "Bundle prices have no interval", "VALIDATION_FAILED");
    if (p.compareAtMinor !== null && p.compareAtMinor <= p.amountMinor) throw badRequest("The compare-at price must be higher than the price", "VALIDATION_FAILED");
    const key = `${p.currency}|${p.interval ?? ""}`;
    if (seen.has(key)) throw badRequest("One price per currency and interval", "DUPLICATE_PRICE");
    seen.add(key);
  }
}

async function putPrices(actor: Actor, type: "PLAN" | "BUNDLE", id: string, wanted: WantedPrice[], ip: string | null): Promise<AdminPrice[]> {
  await validatePrices(wanted, type === "PLAN");
  const rows = await withTransaction(async (trx) => {
    const exists = type === "PLAN" ? await planRepo.byId(id, trx) : await bundleAdminRepo.byId(id, trx);
    if (!exists) throw notFound(type === "PLAN" ? "Plan not found" : "Bundle not found");
    const out = await planRepo.replacePrices(type, id, wanted, trx);
    await audit({ actorId: actor.id, action: `${type.toLowerCase()}.prices`, entityType: type.toLowerCase(), entityId: id, ip, data: { prices: wanted } }, trx);
    return out;
  });
  return rows.map(toAdminPrice);
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export interface PlanInput {
  slug: string;
  name: string;
  description?: string;
  features?: string[];
  trialDays?: number;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  position?: number;
}

export async function listPlansAdmin(actor: Actor): Promise<AdminPlan[]> {
  requireArea(actor, "plans");
  return presentAdminPlans(await planRepo.list());
}

async function planOut(id: string): Promise<AdminPlan> {
  return (await presentAdminPlans([(await planRepo.byId(id))!]))[0] as AdminPlan;
}

export async function createPlan(actor: Actor, input: PlanInput, ip: string | null): Promise<AdminPlan> {
  requireArea(actor, "plans");
  const id = newId();
  try {
    await withTransaction(async (trx) => {
      await trx.insertInto("plans").values({ id, slug: input.slug, name: input.name, description: input.description ?? "", features: input.features ?? [], trial_days: input.trialDays ?? 0, status: input.status ?? "DRAFT", position: input.position ?? 0 }).execute();
      await audit({ actorId: actor.id, action: "plan.create", entityType: "plan", entityId: id, ip, data: { ...input } }, trx);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That slug is taken", "SLUG_TAKEN");
    throw err;
  }
  return planOut(id);
}

export async function updatePlan(actor: Actor, id: string, patch: Partial<PlanInput>, ip: string | null): Promise<AdminPlan> {
  requireArea(actor, "plans");
  try {
    await withTransaction(async (trx) => {
      const before = await planRepo.byId(id, trx);
      if (!before) throw notFound("Plan not found");
      const set = {
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.features !== undefined ? { features: patch.features } : {}),
        ...(patch.trialDays !== undefined ? { trial_days: patch.trialDays } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
      };
      if (Object.keys(set).length) await trx.updateTable("plans").set({ ...set, updated_at: new Date() }).where("id", "=", id).execute();
      await audit({ actorId: actor.id, action: "plan.update", entityType: "plan", entityId: id, ip, data: { patch } }, trx);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That slug is taken", "SLUG_TAKEN");
    throw err;
  }
  return planOut(id);
}

export async function putPlanPrices(actor: Actor, id: string, prices: { currency: string; interval: "MONTH" | "YEAR"; amountMinor: number }[], ip: string | null): Promise<AdminPrice[]> {
  requireArea(actor, "plans");
  return putPrices(actor, "PLAN", id, prices.map((p) => ({ currency: p.currency, interval: p.interval, amountMinor: p.amountMinor, compareAtMinor: null })), ip);
}

// ─── Bundles ────────────────────────────────────────────────────────────────

export interface BundleInput {
  slug: string;
  title: string;
  description?: string;
  coverUploadId?: string | null;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  courseIds?: string[];
}

async function assertCoursesExist(ids: string[], exec: Executor): Promise<void> {
  if (new Set(ids).size !== ids.length) throw badRequest("A course is listed twice", "DUPLICATE_COURSE");
  if (!ids.length) return;
  const found = await exec.selectFrom("courses").select("id").where("id", "in", ids).execute();
  if (found.length !== ids.length) throw badRequest("One of the courses does not exist", "UNKNOWN_COURSE");
}

async function bundleOut(id: string): Promise<AdminBundle> {
  return (await presentAdminBundles([(await bundleAdminRepo.byId(id))!]))[0] as AdminBundle;
}

export async function listBundlesAdmin(actor: Actor, q: { q?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; cursor?: string; limit?: number }): Promise<Page<AdminBundle>> {
  requireArea(actor, "plans");
  const limit = q.limit ?? 20;
  const page = timePage(await bundleAdminRepo.list({ q: q.q, status: q.status, cursor: decodeTime(q.cursor), limit }), limit);
  return { items: await presentAdminBundles(page.items), nextCursor: page.nextCursor };
}

export async function getBundleAdmin(actor: Actor, id: string): Promise<AdminBundle> {
  requireArea(actor, "plans");
  if (!(await bundleAdminRepo.byId(id))) throw notFound("Bundle not found");
  return bundleOut(id);
}

export async function createBundle(actor: Actor, input: BundleInput, ip: string | null): Promise<AdminBundle> {
  requireArea(actor, "plans");
  const id = newId();
  try {
    await withTransaction(async (trx) => {
      const courseIds = input.courseIds ?? [];
      await assertCoursesExist(courseIds, trx);
      if (input.status === "ACTIVE" && !courseIds.length) throw conflict("Add at least one course before activating the bundle", "BUNDLE_EMPTY");
      const cover = await claimSingle(actor.id, input.coverUploadId, "COURSE_COVER", trx);
      await trx.insertInto("bundles").values({ id, slug: input.slug, title: input.title, description: input.description ?? "", cover_upload_id: cover, status: input.status ?? "DRAFT" }).execute();
      await bundleAdminRepo.replaceCourses(id, courseIds, trx);
      await audit({ actorId: actor.id, action: "bundle.create", entityType: "bundle", entityId: id, ip, data: { slug: input.slug, title: input.title, courseIds } }, trx);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That slug is taken", "SLUG_TAKEN");
    throw err;
  }
  return bundleOut(id);
}

export async function updateBundle(actor: Actor, id: string, patch: Partial<BundleInput>, ip: string | null): Promise<AdminBundle> {
  requireArea(actor, "plans");
  try {
    await withTransaction(async (trx) => {
      const before = await trx.selectFrom("bundles").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
      if (!before) throw notFound("Bundle not found");
      if (patch.courseIds) {
        await assertCoursesExist(patch.courseIds, trx);
        await bundleAdminRepo.replaceCourses(id, patch.courseIds, trx);
      }
      const status = patch.status ?? before.status;
      if (status === "ACTIVE" && (await bundleAdminRepo.courseCount(id, trx)) === 0) throw conflict("Add at least one course before activating the bundle", "BUNDLE_EMPTY");
      const set = {
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.coverUploadId !== undefined ? { cover_upload_id: patch.coverUploadId === before.cover_upload_id ? before.cover_upload_id : await claimSingle(actor.id, patch.coverUploadId, "COURSE_COVER", trx) } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      };
      await trx.updateTable("bundles").set({ ...set, updated_at: new Date() }).where("id", "=", id).execute();
      await audit({ actorId: actor.id, action: "bundle.update", entityType: "bundle", entityId: id, ip, data: { patch } }, trx);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("That slug is taken", "SLUG_TAKEN");
    throw err;
  }
  return bundleOut(id);
}

export async function putBundlePrices(actor: Actor, id: string, prices: { currency: string; amountMinor: number; compareAtMinor?: number | null }[], ip: string | null): Promise<AdminPrice[]> {
  requireArea(actor, "plans");
  return putPrices(actor, "BUNDLE", id, prices.map((p) => ({ currency: p.currency, interval: null, amountMinor: p.amountMinor, compareAtMinor: p.compareAtMinor ?? null })), ip);
}

// ─── Coupons ────────────────────────────────────────────────────────────────

export interface CouponInput {
  code: string;
  description?: string | null;
  kind: "PERCENT" | "FIXED";
  percentOff?: number | null;
  amountOffMinor?: number | null;
  currency?: string | null;
  scope: CouponScope;
  targets?: { type: SellableType; id: string }[];
  maxRedemptions?: number | null;
  perUserLimit?: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  active?: boolean;
}

export type CouponPatch = Partial<Pick<CouponInput, "description" | "targets" | "maxRedemptions" | "perUserLimit" | "startsAt" | "expiresAt" | "active">>;

async function assertTargets(scope: CouponScope, targets: { type: SellableType; id: string }[] | undefined, exec: Executor): Promise<{ type: SellableType; id: string }[]> {
  const list = targets ?? [];
  if (scope !== "SPECIFIC") {
    if (list.length) throw badRequest("Targets are only for SPECIFIC coupons", "VALIDATION_FAILED");
    return [];
  }
  if (!list.length) throw badRequest("A SPECIFIC coupon needs at least one target", "VALIDATION_FAILED");
  const keys = new Set(list.map((t) => `${t.type}:${t.id}`));
  if (keys.size !== list.length) throw badRequest("A target is listed twice", "VALIDATION_FAILED");
  const of = (t: SellableType) => list.filter((x) => x.type === t).map((x) => x.id);
  const [courses, bundles, plans] = await Promise.all([
    of("COURSE").length ? exec.selectFrom("courses").select("id").where("id", "in", of("COURSE")).execute() : [],
    of("BUNDLE").length ? exec.selectFrom("bundles").select("id").where("id", "in", of("BUNDLE")).execute() : [],
    of("PLAN").length ? exec.selectFrom("plans").select("id").where("id", "in", of("PLAN")).execute() : [],
  ]);
  if (courses.length + bundles.length + plans.length !== list.length) throw badRequest("One of the targets does not exist", "UNKNOWN_TARGET");
  return list;
}

function checkWindow(startsAt: Date | null, expiresAt: Date | null): void {
  if (startsAt && expiresAt && startsAt >= expiresAt) throw badRequest("The coupon must start before it expires", "VALIDATION_FAILED");
}

export async function listCoupons(actor: Actor, q: { q?: string; cursor?: string; limit?: number }): Promise<Page<AdminCoupon>> {
  requireArea(actor, "coupons");
  const limit = q.limit ?? 20;
  const page = timePage(await couponRepo.list({ q: q.q, cursor: decodeTime(q.cursor), limit }), limit);
  return { items: await presentCoupons(page.items), nextCursor: page.nextCursor };
}

async function couponOut(id: string): Promise<AdminCoupon> {
  return (await presentCoupons([(await couponRepo.byId(id))!]))[0] as AdminCoupon;
}

export async function createCoupon(actor: Actor, input: CouponInput, ip: string | null): Promise<AdminCoupon> {
  requireArea(actor, "coupons");
  // Mirror the table CHECKs so the error is a 400 with a reason, not a constraint name.
  if (input.kind === "PERCENT" && (!input.percentOff || input.amountOffMinor || input.currency)) throw badRequest("A PERCENT coupon has percentOff (1 to 100) and no amount or currency", "VALIDATION_FAILED");
  if (input.kind === "FIXED" && (!input.amountOffMinor || !input.currency || input.percentOff)) throw badRequest("A FIXED coupon has amountOffMinor and currency, and no percentOff", "VALIDATION_FAILED");
  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  checkWindow(startsAt, expiresAt);
  const id = newId();
  try {
    await withTransaction(async (trx) => {
      const targets = await assertTargets(input.scope, input.targets, trx);
      await trx
        .insertInto("coupons")
        .values({
          id,
          code: input.code,
          description: input.description ?? null,
          kind: input.kind,
          percent_off: input.kind === "PERCENT" ? (input.percentOff ?? null) : null,
          amount_off_minor: input.kind === "FIXED" ? (input.amountOffMinor ?? null) : null,
          currency: input.kind === "FIXED" ? (input.currency ?? null) : null,
          scope: input.scope,
          max_redemptions: input.maxRedemptions ?? null,
          per_user_limit: input.perUserLimit ?? 1,
          starts_at: startsAt,
          expires_at: expiresAt,
          active: input.active ?? true,
          created_by: actor.id,
        })
        .execute();
      await couponRepo.replaceTargets(id, targets, trx);
      await audit({ actorId: actor.id, action: "coupon.create", entityType: "coupon", entityId: id, ip, data: { ...input } }, trx);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("A coupon with that code exists", "COUPON_CODE_TAKEN");
    throw err;
  }
  return couponOut(id);
}

/** Code, kind, value and scope are fixed once created (learners may have quotes on them); the rest is editable. */
export async function updateCoupon(actor: Actor, id: string, patch: CouponPatch, ip: string | null): Promise<AdminCoupon> {
  requireArea(actor, "coupons");
  await withTransaction(async (trx) => {
    const before = await trx.selectFrom("coupons").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
    if (!before) throw notFound("Coupon not found");
    if (patch.maxRedemptions !== undefined && patch.maxRedemptions !== null && patch.maxRedemptions < before.redemption_count) throw conflict(`It has already been redeemed ${before.redemption_count} times`, "BELOW_REDEMPTIONS");
    const startsAt = patch.startsAt !== undefined ? (patch.startsAt ? new Date(patch.startsAt) : null) : before.starts_at;
    const expiresAt = patch.expiresAt !== undefined ? (patch.expiresAt ? new Date(patch.expiresAt) : null) : before.expires_at;
    checkWindow(startsAt, expiresAt);
    if (patch.targets !== undefined) await couponRepo.replaceTargets(id, await assertTargets(before.scope, patch.targets, trx), trx);
    await trx
      .updateTable("coupons")
      .set({
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.maxRedemptions !== undefined ? { max_redemptions: patch.maxRedemptions } : {}),
        ...(patch.perUserLimit !== undefined ? { per_user_limit: patch.perUserLimit } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        starts_at: startsAt,
        expires_at: expiresAt,
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();
    await audit({ actorId: actor.id, action: "coupon.update", entityType: "coupon", entityId: id, ip, data: { patch } }, trx);
  });
  return couponOut(id);
}

// ─── CSV export ─────────────────────────────────────────────────────────────

const CSV_HEADER = ["number", "created_at", "paid_at", "status", "kind", "gateway", "buyer_email", "buyer_username", "currency", "subtotal", "discount", "tax", "total", "refunded", "coupon", "tax_label", "tax_rate_bps", "billing_name", "billing_country"];

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Orders created in [from, to), oldest first, streamed in keyset pages of 500. */
export async function* exportOrders(actor: Actor, range: { from?: string; to?: string }): AsyncGenerator<string> {
  requireArea(actor, "orders");
  const to = range.to ? new Date(range.to) : new Date();
  const from = range.from ? new Date(range.from) : new Date(to.getTime() - 30 * 86_400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw badRequest("Give a valid range: from before to", "INVALID_RANGE");
  if (to.getTime() - from.getTime() > 400 * 86_400_000) throw badRequest("Export at most 400 days at a time", "RANGE_TOO_LARGE");
  await audit({ actorId: actor.id, action: "orders.export", entityType: "order", data: { from: from.toISOString(), to: to.toISOString() } });
  yield `${CSV_HEADER.join(",")}\r\n`;
  let after: { at: Date; id: string } | null = null;
  for (;;) {
    const rows = await orderRepo.exportPage(from, to, after, 500);
    if (!rows.length) return;
    let chunk = "";
    for (const r of rows) {
      const tax = (r.tax ?? {}) as { label?: string; rateBps?: number };
      const billing = (r.billing ?? {}) as { name?: string; country?: string };
      const m = (n: number) => formatMinor(n, r.currency);
      chunk += [r.number, r.created_at.toISOString(), r.paid_at?.toISOString() ?? "", r.status, r.kind, r.gateway, r.email, r.username, r.currency, m(r.subtotal_minor), m(r.discount_minor), m(r.tax_minor), m(r.total_minor), m(r.refunded_minor), r.coupon_code ?? "", tax.label ?? "", tax.rateBps ?? 0, billing.name ?? "", billing.country ?? ""].map(csvCell).join(",") + "\r\n";
    }
    yield chunk;
    const last = rows[rows.length - 1]!;
    after = { at: last.created_at, id: last.id };
    if (rows.length < 500) return;
  }
}
