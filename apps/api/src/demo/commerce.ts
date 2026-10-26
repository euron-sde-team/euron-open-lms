/**
 * The demo academy's commerce: bundles, the all-access plan, coupons, and the orders,
 * subscriptions and refund that explain how every learner got their courses.
 *
 * Orders are priced with domain/pricing.ts exactly as checkout prices them, created
 * PENDING with a gateway reference, then paid through the same fulfilment path a webhook
 * uses, so enrollments, coupon redemptions and gap-free invoice numbers are real.
 */
import { randomBytes } from "node:crypto";
import { withTransaction } from "../core/effects";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { orderNumber } from "../domain/orders";
import { price, taxRuleFor } from "../domain/pricing";
import { getSettings } from "../services/settings.service";
import { grantEnrollment } from "../services/enrollment.service";
import { fulfilDemoOrder, refundDemoOrder } from "./fulfil";
import type { DemoUser, SeededCourse } from "./seed";

export interface SeededCatalog {
  courses: SeededCourse[];
}

export interface PlannedEnrollment {
  userId: string;
  courseId: string;
  /** How far through the course the learner gets (0..1). */
  target: number;
}

interface Ctx {
  admin: string;
  learners: DemoUser[];
  catalog: SeededCatalog;
  now: number;
  int: (a: number, b: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  sample: <T>(xs: readonly T[], n: number) => T[];
  rand: () => number;
}

const DAY = 86_400_000;

/** A progress target: some just browsing, most part-way, a few finished. */
function target(rand: () => number): number {
  const r = rand();
  if (r < 0.12) return 0;
  if (r < 0.62) return 0.15 + rand() * 0.6;
  return 1;
}

export async function seedCommerce(ctx: Ctx): Promise<{ enrollments: PlannedEnrollment[]; orders: number }> {
  const { catalog, learners, now, int, pick, sample, rand } = ctx;
  const bySlug = new Map(catalog.courses.map((c) => [c.slug, c]));
  const settings = await getSettings();

  // ── Bundles ───────────────────────────────────────────────────────────
  const bundles = [
    { slug: "data-career-starter", title: "Data Career Starter", description: "SQL, statistics and machine learning: the three courses most analysts take first, together.", courses: ["practical-sql", "statistics-for-decisions", "machine-learning-foundations"], usd: 12900, inr: 999900 },
    { slug: "production-ready-engineer", title: "Production-Ready Engineer", description: "Types, APIs and containers: everything between your editor and a calm on-call week.", courses: ["modern-typescript", "building-reliable-apis", "containers-and-kubernetes"], usd: 16900, inr: 1299900 },
  ];
  const bundleIds = new Map<string, string>();
  for (const b of bundles) {
    const id = newId();
    bundleIds.set(b.slug, id);
    await db.insertInto("bundles").values({ id, slug: b.slug, title: b.title, description: b.description, status: "ACTIVE" }).execute();
    for (const [i, s] of b.courses.entries()) await db.insertInto("bundle_courses").values({ bundle_id: id, course_id: bySlug.get(s)!.id, position: i }).execute();
    await db.insertInto("prices").values([
      { id: newId(), sellable_type: "BUNDLE", sellable_id: id, currency: "USD", amount_minor: b.usd },
      { id: newId(), sellable_type: "BUNDLE", sellable_id: id, currency: "INR", amount_minor: b.inr },
    ]).execute();
  }

  // ── The plan ──────────────────────────────────────────────────────────
  const planId = newId();
  await db
    .insertInto("plans")
    .values({ id: planId, slug: "all-access", name: "All-Access", description: "Every course in the catalog, including the members-only ones, for as long as you are subscribed.", features: ["Every current and future course", "Members-only courses", "Certificates for everything you finish", "Cancel any time"], trial_days: 7, status: "ACTIVE" })
    .execute();
  const planPrices = {
    USD: { MONTH: newId(), YEAR: newId() },
    INR: { MONTH: newId(), YEAR: newId() },
  };
  await db.insertInto("prices").values([
    { id: planPrices.USD.MONTH, sellable_type: "PLAN", sellable_id: planId, currency: "USD", amount_minor: 1900, interval: "MONTH" },
    { id: planPrices.USD.YEAR, sellable_type: "PLAN", sellable_id: planId, currency: "USD", amount_minor: 19000, interval: "YEAR" },
    { id: planPrices.INR.MONTH, sellable_type: "PLAN", sellable_id: planId, currency: "INR", amount_minor: 149900, interval: "MONTH" },
    { id: planPrices.INR.YEAR, sellable_type: "PLAN", sellable_id: planId, currency: "INR", amount_minor: 1499900, interval: "YEAR" },
  ]).execute();

  // ── Coupons ───────────────────────────────────────────────────────────
  const welcome = newId();
  await db.insertInto("coupons").values([
    { id: welcome, code: "WELCOME20", description: "20% off your first course", kind: "PERCENT", percent_off: 20, scope: "COURSES", max_redemptions: 500, per_user_limit: 1, created_by: ctx.admin },
    { id: newId(), code: "INR500", description: "₹500 off any course", kind: "FIXED", amount_off_minor: 50000, currency: "INR", scope: "COURSES", per_user_limit: 1, created_by: ctx.admin },
    { id: newId(), code: "BUNDLE15", description: "15% off bundles", kind: "PERCENT", percent_off: 15, scope: "BUNDLES", per_user_limit: 1, expires_at: new Date(now + 45 * DAY), created_by: ctx.admin },
  ]).execute();

  const planned: PlannedEnrollment[] = [];
  let orders = 0;
  const free = catalog.courses.filter((c) => c.access === "FREE");
  const paid = catalog.courses.filter((c) => c.access === "PAID");
  const memberOnly = catalog.courses.filter((c) => c.access === "SUBSCRIPTION_ONLY");

  // Learners 0..5 subscribe (0..3 active, 4 cancels at period end, 5 past due).
  const subscribers = learners.slice(0, 6);
  for (const [i, l] of subscribers.entries()) {
    const currency = l.inr ? "INR" : "USD";
    const interval = i === 2 ? "YEAR" : "MONTH";
    const priceId = planPrices[currency][interval];
    const amount = currency === "USD" ? (interval === "YEAR" ? 19000 : 1900) : interval === "YEAR" ? 1499900 : 149900;
    const start = new Date(now - int(3, 24) * DAY);
    const periodEnd = new Date(start.getTime() + (interval === "YEAR" ? 365 : 30) * DAY);
    const subId = newId();
    const gateway = currency === "INR" ? "RAZORPAY" : "STRIPE";
    const status = i === 5 ? "PAST_DUE" : "ACTIVE";
    await db
      .insertInto("subscriptions")
      .values({
        id: subId,
        user_id: l.id,
        plan_id: planId,
        price_id: priceId,
        gateway,
        gateway_subscription_ref: `${gateway === "STRIPE" ? "sub_demo_" : "sub_rzp_demo_"}${randomBytes(6).toString("hex")}`,
        status,
        currency,
        amount_minor: amount,
        interval,
        current_period_start: start,
        current_period_end: i === 5 ? new Date(now - DAY) : periodEnd,
        cancel_at_period_end: i === 4,
        created_at: start,
      })
      .execute();
    const orderId = await createOrder({ userId: l.id, kind: "SUBSCRIPTION", currency, lines: [{ type: "PLAN", id: planId, title: "All-Access", unit: amount, priceId }], couponId: null, couponCode: null, country: l.inr ? "IN" : "US", name: l.name, settings, at: start, planId, priceId });
    await fulfilDemoOrder(orderId, start);
    await db.updateTable("subscriptions").set({ first_order_id: orderId }).where("id", "=", subId).execute();
    orders++;
    for (const c of sample([...memberOnly, ...paid], int(2, 4))) planned.push({ userId: l.id, courseId: c.id, target: target(rand) });
  }
  const planned0 = planned.length;
  // Subscription enrollments are opened (not bought): the access service creates them on first open.
  for (const p of planned.slice(0, planned0)) {
    await db
      .insertInto("enrollments")
      .values({ id: newId(), user_id: p.userId, course_id: p.courseId, source: "SUBSCRIPTION", created_at: new Date(now - int(3, 30) * DAY), last_activity_at: new Date() })
      .onConflict((oc) => oc.columns(["user_id", "course_id"]).doNothing())
      .execute();
    await db.updateTable("courses").set((eb) => ({ enrollment_count: eb("enrollment_count", "+", 1) })).where("id", "=", p.courseId).execute();
  }

  // Everyone else: free courses, single purchases, a few bundles and admin grants.
  for (const [i, l] of learners.slice(6).entries()) {
    const currency = l.inr ? "INR" : "USD";
    for (const c of sample(free, int(0, 2))) {
      await withTransaction((trx, fx) => grantEnrollment({ userId: l.id, courseId: c.id, source: "FREE" }, trx, fx));
      planned.push({ userId: l.id, courseId: c.id, target: target(rand) });
    }
    if (i % 7 === 3) {
      const b = bundles[i % 2]!;
      const bid = bundleIds.get(b.slug)!;
      const at = new Date(now - int(5, 50) * DAY);
      const orderId = await createOrder({ userId: l.id, kind: "ONE_TIME", currency, lines: [{ type: "BUNDLE", id: bid, title: b.title, unit: currency === "USD" ? b.usd : b.inr, priceId: null }], couponId: null, couponCode: null, country: l.inr ? "IN" : "US", name: l.name, settings, at, planId: null, priceId: null });
      await fulfilDemoOrder(orderId, at);
      orders++;
      for (const s of b.courses) planned.push({ userId: l.id, courseId: bySlug.get(s)!.id, target: target(rand) });
      continue;
    }
    const buys = sample(paid.filter((c) => (currency === "USD" ? c.usd : c.inr)), int(1, 3));
    for (const [bi, c] of buys.entries()) {
      const at = new Date(now - int(2, 58) * DAY);
      const useCoupon = bi === 0 && rand() < 0.3;
      const orderId = await createOrder({
        userId: l.id,
        kind: "ONE_TIME",
        currency,
        lines: [{ type: "COURSE", id: c.id, title: c.title, unit: (currency === "USD" ? c.usd : c.inr)!, priceId: null }],
        couponId: useCoupon ? welcome : null,
        couponCode: useCoupon ? "WELCOME20" : null,
        country: l.inr ? "IN" : "US",
        name: l.name,
        settings,
        at,
        planId: null,
        priceId: null,
      });
      await fulfilDemoOrder(orderId, at);
      orders++;
      planned.push({ userId: l.id, courseId: c.id, target: target(rand) });
    }
    if (i % 11 === 5) {
      const c = pick(memberOnly);
      await withTransaction((trx, fx) => grantEnrollment({ userId: l.id, courseId: c.id, source: "GRANT", grantedBy: ctx.admin, note: "Scholarship", validUntil: new Date(now + 60 * DAY) }, trx, fx));
      planned.push({ userId: l.id, courseId: c.id, target: target(rand) });
    }
  }

  // One refunded purchase: money back, access revoked, a credit note issued.
  const refundable = await db.selectFrom("orders").select(["id"]).where("status", "=", "PAID").where("kind", "=", "ONE_TIME").where("gateway", "=", "STRIPE").orderBy("created_at").limit(1).executeTakeFirst();
  if (refundable) await refundDemoOrder(refundable.id, ctx.admin, "Bought the wrong course by mistake");

  // An abandoned checkout, so the orders list shows every state.
  const l = learners[7]!;
  const c = paid[0]!;
  await createOrder({ userId: l.id, kind: "ONE_TIME", currency: "USD", lines: [{ type: "COURSE", id: c.id, title: c.title, unit: c.usd ?? 4900, priceId: null }], couponId: null, couponCode: null, country: "US", name: l.name, settings, at: new Date(now - 2 * DAY), planId: null, priceId: null, status: "EXPIRED" });

  return { enrollments: dedupe(planned), orders };
}

function dedupe(xs: PlannedEnrollment[]): PlannedEnrollment[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = `${x.userId}:${x.courseId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

interface OrderInput {
  userId: string;
  kind: "ONE_TIME" | "SUBSCRIPTION";
  currency: string;
  lines: { type: "COURSE" | "BUNDLE" | "PLAN"; id: string; title: string; unit: number; priceId: string | null }[];
  couponId: string | null;
  couponCode: string | null;
  country: string;
  name: string;
  settings: Awaited<ReturnType<typeof getSettings>>;
  at: Date;
  planId: string | null;
  priceId: string | null;
  status?: "PENDING" | "EXPIRED";
}

/** A priced PENDING order, as checkout/start leaves it before the gateway answers. */
async function createOrder(o: OrderInput): Promise<string> {
  const rule = taxRuleFor(o.settings.tax.rules, o.country);
  const coupon = o.couponId ? await db.selectFrom("coupons").selectAll().where("id", "=", o.couponId).executeTakeFirstOrThrow() : null;
  const priced = price(
    o.lines.map((l) => ({ key: `${l.type}:${l.id}`, unitMinor: l.unit })),
    coupon ? { kind: coupon.kind, percentOff: coupon.percent_off, amountOffMinor: coupon.amount_off_minor } : null,
    { enabled: o.settings.tax.enabled && !!rule, mode: o.settings.tax.mode, rateBps: rule?.rateBps ?? 0, label: rule?.label ?? null },
  );
  const id = newId();
  const gateway = o.currency === "INR" ? "RAZORPAY" : "STRIPE";
  await db
    .insertInto("orders")
    .values({
      id,
      number: orderNumber(randomBytes(8)),
      user_id: o.userId,
      kind: o.kind,
      status: o.status ?? "PENDING",
      currency: o.currency,
      subtotal_minor: priced.subtotalMinor,
      discount_minor: priced.discountMinor,
      tax_minor: priced.taxMinor,
      total_minor: priced.totalMinor,
      coupon_id: o.couponId,
      coupon_code: o.couponCode,
      gateway,
      gateway_ref: `${gateway === "STRIPE" ? "cs_demo_" : "order_demo_"}${randomBytes(8).toString("hex")}`,
      tax: JSON.stringify({ mode: priced.taxMode, rateBps: priced.taxRateBps, label: priced.taxLabel, country: o.country }),
      billing: JSON.stringify({ name: o.name, country: o.country }),
      plan_id: o.planId,
      price_id: o.priceId,
      idempotency_key: newId(),
      expires_at: new Date(o.at.getTime() + 60 * 60_000),
      created_at: o.at,
      updated_at: o.at,
    })
    .execute();
  await db
    .insertInto("order_items")
    .values(
      priced.lines.map((l, i) => ({
        id: newId(),
        order_id: id,
        sellable_type: o.lines[i]!.type,
        sellable_id: o.lines[i]!.id,
        title: o.lines[i]!.title,
        price_id: o.lines[i]!.priceId,
        unit_minor: l.unitMinor,
        discount_minor: l.discountMinor,
        tax_minor: l.taxMinor,
        total_minor: l.totalMinor,
      })),
    )
    .execute();
  return id;
}
