/**
 * Checkout: plans on sale, quotes, starting a payment, the Razorpay client return, and
 * the learner's own order status.
 *
 * Pricing rules (the source system trusted client amounts; this one never does):
 *   - every amount comes from the price book (priceRepo) and domain/pricing.ts price():
 *     a course's one-time price, a bundle's price, a plan's price for the interval;
 *   - coupons are checked by domain/pricing.ts couponProblem, with the scope (ALL,
 *     COURSES, BUNDLES, PLANS, SPECIFIC via coupon_targets), FIXED coupons only in
 *     their own currency, and per-learner use counted from paid orders. On plans a
 *     coupon discounts the first payment only, and is not offered on Razorpay plans
 *     (Razorpay subscriptions cannot carry a one-off discount) or during a free trial;
 *   - tax from settings.tax (rule by the buyer's billing country, mode EXCLUSIVE or
 *     INCLUSIVE), frozen onto the order;
 *   - the currency picks the gateway (settings.gateways routing, configured gateways
 *     only, Razorpay only for the currencies it takes).
 *
 * Starting:
 *   - 409 ALREADY_OWNED when the learner can already open every course in the item;
 *     409 SUBSCRIPTION_EXISTS when buying a plan with one already running;
 *   - the order is created PENDING with its lines, payable for
 *     settings.learning.orderTtlMinutes, under the learner's idempotency key: a retried
 *     start (same key) returns the same order and handoff, never a second charge;
 *   - a zero total (a 100% coupon) is fulfilled at once with gateway FREE;
 *   - Stripe returns to the web order page, or to `returnUrl` when the client sends one
 *     (the mobile app's openlms:// link, or a page on the web origin: domain/safe-url.ts
 *     checkoutReturnUrl); Razorpay hands the client modal options, and in stub mode a
 *     full-page checkout on the stubs server that native apps open in a browser tab;
 *   - plans: a subscription row is created INCOMPLETE; Stripe Checkout runs in
 *     subscription mode on a recurring Price cached per price row and amount
 *     (prices.gateway_refs), Razorpay on a Subscription of a cached Plan.
 */
import type { BillingDetails, BillingInterval, CheckoutHandoff, CheckoutQuote, CheckoutQuoteRequest, CheckoutStartRequest, CouponKind, Order, Plan, QuoteLine, RazorpayConfirm, SellableType } from "@open-lms/types";
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { config, razorpayCheckoutIsStub } from "../core/config";
import { requireActive, type Actor } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { captureError, logger } from "../core/logger";
import { db, type Executor } from "../db/kysely";
import { orderNumber } from "../domain/orders";
import { couponProblem, price, taxRuleFor, type CouponTerms, type Priced } from "../domain/pricing";
import { checkoutReturnUrl } from "../domain/safe-url";
import { presentOrder } from "../presenters/order.presenter";
import { presentPlans } from "../presenters/plan.presenter";
import { liveSubscriptionOf } from "../presenters/subscription.presenter";
import { couponRepo, type CouponRow } from "../repositories/coupon.repository";
import { orderRepo, type OrderRow } from "../repositories/order.repository";
import { money, priceRepo, type PriceRow } from "../repositories/price.repository";
import { pendingRef, subscriptionRepo } from "../repositories/subscription.repository";
import { decide, findCourse } from "./access.service";
import { closeOrder, fulfilOrder, syncWithGateway } from "./payments/fulfilment.service";
import { GatewayError, routeCurrency, type GatewayHandoff, type GatewayOrder, type PaidGateway } from "./payments/gateway";
import { gatewayOf } from "./payments/gateways";
import { academyName, getSettings } from "./settings.service";

// ─── Plans on sale ──────────────────────────────────────────────────────────

export async function listPlans(viewer: Actor | null, currency: string | undefined): Promise<Plan[]> {
  const settings = await getSettings();
  let c = currency?.toUpperCase();
  if (!c && viewer) c = (await db.selectFrom("users").select("preferred_currency").where("id", "=", viewer.id).executeTakeFirst())?.preferred_currency ?? undefined;
  if (!c || !enabledCurrencies(settings).includes(c)) c = settings.currencies.default;
  const plans = await db.selectFrom("plans").selectAll().where("status", "=", "ACTIVE").orderBy("position").orderBy("created_at").execute();
  return presentPlans(plans, c);
}

function enabledCurrencies(settings: Awaited<ReturnType<typeof getSettings>>): string[] {
  return [...new Set([settings.currencies.default, ...settings.currencies.enabled])];
}

// ─── What is being bought ───────────────────────────────────────────────────

interface Sellable {
  type: SellableType;
  id: string;
  title: string;
  /** Courses the purchase grants (empty for plans: plan access is computed). */
  courseIds: string[];
  price: PriceRow;
  interval: BillingInterval | null;
  trialDays: number;
}

async function resolveItem(item: CheckoutQuoteRequest["item"], currency: string, exec: Executor = db): Promise<Sellable> {
  if (item.type === "COURSE") {
    const course = await exec.selectFrom("courses").select(["id", "title", "status", "access_mode"]).where("id", "=", item.id).executeTakeFirst();
    if (!course || course.status !== "PUBLISHED") throw notFound("Course not found");
    if (course.access_mode !== "PAID") throw conflict(course.access_mode === "FREE" ? "This course is free: enroll from its page" : "This course is only available with a plan", "NOT_FOR_SALE");
    const p = await priceRepo.oneTime("COURSE", course.id, currency, exec);
    if (!p) throw conflict(`This course is not sold in ${currency}`, "PRICE_NOT_AVAILABLE");
    return { type: "COURSE", id: course.id, title: course.title, courseIds: [course.id], price: p, interval: null, trialDays: 0 };
  }
  if (item.type === "BUNDLE") {
    const bundle = await exec.selectFrom("bundles").select(["id", "title", "status"]).where("id", "=", item.id).executeTakeFirst();
    if (!bundle || bundle.status !== "ACTIVE") throw notFound("Bundle not found");
    const courses = await exec.selectFrom("bundle_courses as bc").innerJoin("courses as c", "c.id", "bc.course_id").select("c.id").where("bc.bundle_id", "=", bundle.id).where("c.status", "=", "PUBLISHED").orderBy("bc.position").execute();
    if (!courses.length) throw conflict("This bundle has no courses yet", "BUNDLE_EMPTY");
    const p = await priceRepo.oneTime("BUNDLE", bundle.id, currency, exec);
    if (!p) throw conflict(`This bundle is not sold in ${currency}`, "PRICE_NOT_AVAILABLE");
    return { type: "BUNDLE", id: bundle.id, title: bundle.title, courseIds: courses.map((c) => c.id), price: p, interval: null, trialDays: 0 };
  }
  const plan = await exec.selectFrom("plans").select(["id", "name", "status", "trial_days"]).where("id", "=", item.id).executeTakeFirst();
  if (!plan || plan.status !== "ACTIVE") throw notFound("Plan not found");
  if (!item.interval) throw badRequest("Choose monthly or yearly billing", "INTERVAL_REQUIRED");
  const p = (await priceRepo.planPrices(plan.id, currency, exec)).find((r) => r.interval === item.interval);
  if (!p) throw conflict(`This plan is not sold ${item.interval === "YEAR" ? "yearly" : "monthly"} in ${currency}`, "PRICE_NOT_AVAILABLE");
  return { type: "PLAN", id: plan.id, title: plan.name, courseIds: [], price: p, interval: item.interval, trialDays: plan.trial_days };
}

type CouponError = NonNullable<CheckoutQuote["couponError"]>;

async function couponApplies(c: CouponRow, s: Sellable): Promise<boolean> {
  switch (c.scope) {
    case "ALL":
      return true;
    case "COURSES":
      return s.type === "COURSE";
    case "BUNDLES":
      return s.type === "BUNDLE";
    case "PLANS":
      return s.type === "PLAN";
    default:
      return couponRepo.isTarget(c.id, s.type, s.id);
  }
}

async function evaluateCoupon(code: string | undefined, actor: Actor, s: Sellable, currency: string, route: PaidGateway | null): Promise<{ coupon: CouponRow | null; error: CouponError | null }> {
  const trimmed = code?.trim();
  if (!trimmed) return { coupon: null, error: null };
  const c = await couponRepo.byCode(trimmed);
  if (!c) return { coupon: null, error: "NOT_FOUND" };
  let applicable = (await couponApplies(c, s)) ? 1 : 0;
  // A plan's coupon discounts the first payment; there is none during a trial, and
  // Razorpay subscriptions cannot carry one.
  if (s.type === "PLAN" && (s.trialDays > 0 || route === "RAZORPAY")) applicable = 0;
  const problem = couponProblem(
    { active: c.active, startsAt: c.starts_at, expiresAt: c.expires_at, maxRedemptions: c.max_redemptions, redemptionCount: c.redemption_count, perUserLimit: c.per_user_limit, kind: c.kind, currency: c.currency },
    { now: new Date(), currency, userRedemptions: await couponRepo.userRedemptions(c.id, actor.id), applicableLines: applicable },
  );
  return problem ? { coupon: null, error: problem } : { coupon: c, error: null };
}

interface QuoteResult {
  quote: CheckoutQuote;
  sellable: Sellable;
  priced: Priced;
  recurringTotal: number | null;
  coupon: CouponRow | null;
  tax: { mode: "EXCLUSIVE" | "INCLUSIVE"; rateBps: number; label: string | null; country: string | null };
  gateway: "STRIPE" | "RAZORPAY" | "FREE";
}

function normalizeBilling(b: BillingDetails | undefined): BillingDetails | undefined {
  return b ? { ...b, country: b.country.toUpperCase() } : undefined;
}

async function buildQuote(actor: Actor, req: CheckoutQuoteRequest): Promise<QuoteResult> {
  const settings = await getSettings();
  const currency = req.currency.toUpperCase();
  if (!enabledCurrencies(settings).includes(currency)) throw badRequest(`Payments in ${currency} are not accepted here`, "CURRENCY_NOT_SUPPORTED");
  const sellable = await resolveItem(req.item, currency);
  const route = routeCurrency(settings, currency);
  const { coupon, error } = await evaluateCoupon(req.couponCode, actor, sellable, currency, route);

  const billing = normalizeBilling(req.billing);
  const rule = settings.tax.enabled ? taxRuleFor(settings.tax.rules, billing?.country) : null;
  const tax = { mode: settings.tax.mode, rateBps: rule?.rateBps ?? 0, label: rule?.label ?? null, country: billing?.country ?? null };
  const taxTerms = { enabled: settings.tax.enabled && !!rule, mode: tax.mode, rateBps: tax.rateBps, label: tax.label };
  const terms: CouponTerms | null = coupon ? { kind: coupon.kind as CouponKind, percentOff: coupon.percent_off, amountOffMinor: coupon.amount_off_minor } : null;

  // A trial's first payment is nothing today; renewals then cost the recurring price.
  const todayUnit = sellable.type === "PLAN" && sellable.trialDays > 0 ? 0 : sellable.price.amount_minor;
  const priced = price([{ key: sellable.id, unitMinor: todayUnit }], terms, taxTerms);
  const recurring = sellable.type === "PLAN" ? price([{ key: sellable.id, unitMinor: sellable.price.amount_minor }], null, taxTerms) : null;
  const kind = sellable.type === "PLAN" ? "SUBSCRIPTION" : "ONE_TIME";
  const gateway = kind === "ONE_TIME" && priced.totalMinor === 0 ? "FREE" : route;
  if (!gateway) throw conflict(`Payments in ${currency} are not available right now`, "CURRENCY_NOT_PAYABLE");

  let alreadyOwned = false;
  if (sellable.courseIds.length) {
    const decisions = await Promise.all(sellable.courseIds.map(async (id) => {
      const course = await findCourse({ id });
      return course ? (await decide(actor, course)).decision.granted : false;
    }));
    alreadyOwned = decisions.every(Boolean);
  }

  const line = priced.lines[0] as Priced["lines"][number];
  const lines: QuoteLine[] = [{ type: sellable.type, id: sellable.id, title: sellable.title, unit: money(line.unitMinor, currency), discount: money(line.discountMinor, currency), tax: money(line.taxMinor, currency), total: money(line.totalMinor, currency) }];
  const quote: CheckoutQuote = {
    currency,
    lines,
    subtotal: money(priced.subtotalMinor, currency),
    discount: money(priced.discountMinor, currency),
    tax: money(priced.taxMinor, currency),
    total: money(priced.totalMinor, currency),
    taxLabel: priced.taxLabel,
    taxMode: priced.taxMode,
    coupon: coupon ? { code: String(coupon.code), description: coupon.description, kind: coupon.kind, percentOff: coupon.percent_off, amountOff: coupon.amount_off_minor !== null && coupon.currency ? money(coupon.amount_off_minor, coupon.currency) : null } : null,
    couponError: error,
    gateway,
    kind,
    recurring: recurring && sellable.interval ? { price: money(recurring.totalMinor, currency), interval: sellable.interval, trialDays: sellable.trialDays } : null,
    alreadyOwned,
  };
  return { quote, sellable, priced, recurringTotal: recurring?.totalMinor ?? null, coupon, tax, gateway };
}

export async function quote(actor: Actor, req: CheckoutQuoteRequest): Promise<CheckoutQuote> {
  return (await buildQuote(actor, req)).quote;
}

// ─── Start ──────────────────────────────────────────────────────────────────

function returnUrls(orderId: string, returnUrl: string | null = null) {
  if (returnUrl) {
    const join = `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}orderId=${orderId}`;
    return { success: `${join}&session_id={CHECKOUT_SESSION_ID}`, cancel: `${join}&canceled=1` };
  }
  const web = config.APP_WEB_URL.replace(/\/$/, "");
  return { success: `${web}/checkout/orders/${orderId}?session_id={CHECKOUT_SESSION_ID}`, cancel: `${web}/checkout/orders/${orderId}?canceled=1` };
}

/** The stubs' full-page Razorpay checkout (stub mode only), for apps that cannot inject Checkout.js. */
function stubCheckoutPage(fields: { keyId: string; razorpayOrderId: string | null; subscriptionId: string | null; amountMinor: number; currency: string; name: string; description: string }): string | null {
  if (!razorpayCheckoutIsStub()) return null;
  const q = new URLSearchParams({ key: fields.keyId, amount: String(fields.amountMinor), currency: fields.currency, name: fields.name, description: fields.description });
  if (fields.razorpayOrderId) q.set("order_id", fields.razorpayOrderId);
  if (fields.subscriptionId) q.set("subscription_id", fields.subscriptionId);
  return `${new URL(config.RAZORPAY_CHECKOUT_SCRIPT_URL).origin}/stub/razorpay/checkout-page?${q.toString()}`;
}

async function customerOf(actor: Actor) {
  const u = await db.selectFrom("users").select(["email", "display_name"]).where("id", "=", actor.id).executeTakeFirstOrThrow();
  return { userId: actor.id, email: u.email, name: u.display_name };
}

async function toHandoff(order: OrderRow, h: GatewayHandoff | null, actor: Actor): Promise<CheckoutHandoff> {
  if (!h) throw conflict("This checkout has closed; start again", "CHECKOUT_EXPIRED");
  if (h.redirectUrl) return { type: "REDIRECT", orderId: order.id, orderNumber: order.number, url: h.redirectUrl };
  const [customer, items, name] = await Promise.all([customerOf(actor), orderRepo.items([order.id]), academyName()]);
  const modal = {
    keyId: config.RAZORPAY_KEY_ID ?? "",
    razorpayOrderId: h.razorpay?.orderId ?? null,
    subscriptionId: h.razorpay?.subscriptionId ?? null,
    amountMinor: order.total_minor,
    currency: order.currency,
    name,
    description: items.get(order.id)?.[0]?.title ?? order.number,
  };
  const checkoutPageUrl = stubCheckoutPage(modal);
  return {
    type: "RAZORPAY_MODAL",
    orderId: order.id,
    orderNumber: order.number,
    scriptUrl: config.RAZORPAY_CHECKOUT_SCRIPT_URL,
    ...modal,
    prefill: { name: customer.name, email: customer.email },
    mode: checkoutPageUrl ? "stub" : "native",
    checkoutPageUrl,
  };
}

/** The handoff for an order that already exists (a retried start). */
async function handoffFor(order: OrderRow, actor: Actor): Promise<CheckoutHandoff> {
  if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.status)) return { type: "FULFILLED", orderId: order.id, orderNumber: order.number };
  if (order.status !== "PENDING") throw conflict("This checkout has closed; start again", "CHECKOUT_CLOSED", { status: order.status });
  if (order.gateway === "FREE" || !order.gateway_ref) throw conflict("This checkout is still being prepared; try again in a moment", "CHECKOUT_IN_PROGRESS");
  return toHandoff(order, await gatewayOf(order.gateway).resumeHandoff({ gatewayRef: order.gateway_ref, kind: order.kind }), actor);
}

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

/**
 * The gateway's recurring price/plan for this price row and amount, created once and cached.
 * `replace` is a cached ref the gateway refused: a new one is created and stored in its place.
 */
async function planRefFor(gateway: PaidGateway, row: PriceRow, amountMinor: number, title: string, interval: BillingInterval, replace?: string): Promise<string> {
  const key = `${gateway === "STRIPE" ? "stripe" : "razorpay"}${amountMinor === row.amount_minor ? "" : `:${amountMinor}`}`;
  const refs = ((await priceRepo.byId(row.id))?.gateway_refs ?? {}) as Record<string, string>;
  if (refs[key] && refs[key] !== replace) return refs[key];
  const ref = await gatewayOf(gateway).createRecurringPlan({ amountMinor, currency: row.currency, interval, name: title });
  // Keep the first ref stored if two checkouts raced to create (or replace) one.
  await db
    .updateTable("prices")
    .set({ gateway_refs: sql`gateway_refs || jsonb_build_object(${key}::text, ${ref}::text)`, updated_at: new Date() })
    .where("id", "=", row.id)
    .where(replace ? sql<boolean>`gateway_refs->>${key} = ${replace}` : sql<boolean>`NOT (gateway_refs ? ${key})`)
    .execute();
  return (((await priceRepo.byId(row.id))?.gateway_refs ?? {}) as Record<string, string>)[key] ?? ref;
}

export async function start(actorIn: Actor, req: CheckoutStartRequest): Promise<CheckoutHandoff> {
  const actor = requireActive(actorIn);
  const returnUrl = req.returnUrl ? checkoutReturnUrl(req.returnUrl, config.APP_WEB_URL, config.MOBILE_RETURN_SCHEMES) : null;
  if (req.returnUrl && !returnUrl) throw badRequest("returnUrl must be an app link or a page on this academy's website", "RETURN_URL_NOT_ALLOWED");
  const existing = await orderRepo.byIdempotencyKey(actor.id, req.idempotencyKey);
  if (existing) return handoffFor(existing, actor);

  const q = await buildQuote(actor, req);
  if (q.quote.couponError) throw conflict("That coupon cannot be used for this purchase", "COUPON_INVALID", { reason: q.quote.couponError });
  if (q.quote.alreadyOwned) throw conflict("You already have access to this", "ALREADY_OWNED");
  if (q.sellable.type === "PLAN") {
    const current = await liveSubscriptionOf(actor.id);
    if (current && current.status !== "INCOMPLETE") throw conflict("You already have a subscription", "SUBSCRIPTION_EXISTS");
  }

  const settings = await getSettings();
  const orderId = newId();
  const subscriptionId = q.sellable.type === "PLAN" ? newId() : null;
  const line = q.priced.lines[0] as Priced["lines"][number];
  const billing = normalizeBilling(req.billing);
  let inserted = false;
  try {
    inserted = await withTransaction(async (trx) => {
      if (subscriptionId) {
        // Abandoned plan checkouts would otherwise hold the one live-subscription slot.
        for (const stale of await subscriptionRepo.staleIncomplete(actor.id, trx)) {
          if (stale.first_order_id && stale.order_status === "PENDING") await orderRepo.markClosed(stale.first_order_id, "CANCELED", "SUPERSEDED", trx);
          await subscriptionRepo.update(stale.id, ["INCOMPLETE"], { status: "EXPIRED" }, trx);
        }
      }
      const ok = await orderRepo.insert(
        {
          id: orderId,
          number: orderNumber(randomBytes(8)),
          user_id: actor.id,
          kind: q.quote.kind,
          currency: q.quote.currency,
          subtotal_minor: q.priced.subtotalMinor,
          discount_minor: q.priced.discountMinor,
          tax_minor: q.priced.taxMinor,
          total_minor: q.priced.totalMinor,
          coupon_id: q.coupon?.id ?? null,
          coupon_code: q.coupon ? String(q.coupon.code) : null,
          gateway: q.gateway,
          tax: JSON.stringify({ mode: q.priced.taxMode, rateBps: q.priced.taxRateBps, label: q.priced.taxLabel, country: q.tax.country }),
          billing: JSON.stringify(billing ?? {}),
          plan_id: q.sellable.type === "PLAN" ? q.sellable.id : null,
          price_id: q.sellable.price.id,
          idempotency_key: req.idempotencyKey,
          expires_at: new Date(Date.now() + settings.learning.orderTtlMinutes * 60_000),
        },
        [{ id: newId(), sellable_type: q.sellable.type, sellable_id: q.sellable.id, title: q.sellable.title, price_id: q.sellable.price.id, unit_minor: line.unitMinor, discount_minor: line.discountMinor, tax_minor: line.taxMinor, total_minor: line.totalMinor }],
        trx,
      );
      if (!ok) return false;
      if (subscriptionId && q.sellable.interval && q.gateway !== "FREE") {
        await subscriptionRepo.insert(
          { id: subscriptionId, user_id: actor.id, plan_id: q.sellable.id, price_id: q.sellable.price.id, gateway: q.gateway, gateway_subscription_ref: pendingRef(orderId), currency: q.quote.currency, amount_minor: q.recurringTotal ?? q.sellable.price.amount_minor, interval: q.sellable.interval, first_order_id: orderId },
          trx,
        );
      }
      return true;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Another checkout is already in progress; finish or cancel it first", "CHECKOUT_IN_PROGRESS");
    throw err;
  }
  if (!inserted) {
    // A concurrent start with the same key won: hand back its order.
    const winner = await orderRepo.byIdempotencyKey(actor.id, req.idempotencyKey);
    if (!winner) throw conflict("Try again", "CHECKOUT_IN_PROGRESS");
    return handoffFor(winner, actor);
  }
  const order = (await orderRepo.byId(orderId)) as OrderRow;

  if (q.gateway === "FREE") {
    const r = await fulfilOrder(order.id, { amountMinor: 0, currency: order.currency, paymentRef: null }, "free");
    if (r.outcome !== "FULFILLED" && r.outcome !== "ALREADY_PAID") throw conflict("This order could not be completed", "CHECKOUT_FAILED");
    return { type: "FULFILLED", orderId: order.id, orderNumber: order.number };
  }

  const gateway = gatewayOf(q.gateway);
  try {
    const customer = await customerOf(actor);
    let customerRef = await orderRepo.customerRef(actor.id, q.gateway);
    if (!customerRef) {
      const created = await gateway.ensureCustomer(customer);
      if (created) customerRef = await orderRepo.saveCustomerRef(actor.id, q.gateway, created);
    }
    const gOrder: GatewayOrder = { id: order.id, number: order.number, currency: order.currency, totalMinor: order.total_minor, expiresAt: order.expires_at, description: q.sellable.title, lines: [{ title: q.sellable.title, totalMinor: line.totalMinor }] };
    let handoff: GatewayHandoff;
    if (q.sellable.type === "PLAN" && q.sellable.interval && subscriptionId) {
      const renewal = q.recurringTotal ?? q.sellable.price.amount_minor;
      const plan = q.sellable;
      const subscribe = (planRef: string) =>
        gateway.createSubscription({ order: gOrder, customerRef, planRef, interval: plan.interval!, firstPaymentDiscountMinor: plan.trialDays > 0 ? 0 : Math.max(0, renewal - order.total_minor), trialDays: plan.trialDays, localSubscriptionId: subscriptionId, urls: returnUrls(order.id, returnUrl) });
      const planRef = await planRefFor(q.gateway, plan.price, renewal, plan.title, plan.interval!);
      try {
        handoff = await subscribe(planRef);
      } catch (err) {
        // A cached plan the gateway no longer knows (deleted in its dashboard, or keys for
        // another account or mode): refused with a 4xx. Create a fresh one and try once more.
        const status = err instanceof GatewayError ? err.gatewayStatus : null;
        if (status === null || status < 400 || status >= 500) throw err;
        logger.warn({ gateway: q.gateway, priceId: plan.price.id }, "checkout: the gateway refused a cached plan; creating a new one");
        handoff = await subscribe(await planRefFor(q.gateway, plan.price, renewal, plan.title, plan.interval!, planRef));
      }
      if (handoff.razorpay?.subscriptionId) await subscriptionRepo.setRef(subscriptionId, handoff.razorpay.subscriptionId, db);
    } else {
      handoff = await gateway.createCheckout(gOrder, customer, customerRef, returnUrls(order.id, returnUrl));
    }
    await orderRepo.setGatewayRef(order.id, handoff.ref);
    return toHandoff({ ...order, gateway_ref: handoff.ref }, handoff, actor);
  } catch (err) {
    await closeOrder(order.id, "FAILED", "GATEWAY_ERROR").catch((e) => captureError(e, { where: "checkout.start.close" }));
    if (err instanceof HttpError) throw err;
    captureError(err, { where: "checkout.start", orderId: order.id });
    throw new GatewayError("The payment provider could not start the checkout");
  }
}

// ─── Razorpay client return ─────────────────────────────────────────────────

/**
 * Checkout.js's success callback, forwarded by the browser. The signature proves the
 * payload came from Razorpay for THIS order; the payment is then fetched from Razorpay
 * and its captured amount goes through fulfilment's amount check like a webhook's.
 */
export async function razorpayConfirm(actor: Actor, body: RazorpayConfirm): Promise<Order> {
  const order = await orderRepo.byId(body.orderId);
  if (!order || order.user_id !== actor.id) throw notFound("Order not found");
  if (order.gateway !== "RAZORPAY" || !order.gateway_ref) throw badRequest("This order is not paid through Razorpay", "WRONG_GATEWAY");
  const isSub = order.kind === "SUBSCRIPTION";
  const claimed = isSub ? body.razorpay_subscription_id : body.razorpay_order_id;
  const gateway = gatewayOf("RAZORPAY");
  const verified = claimed === order.gateway_ref && gateway.verifyClientReturn({ orderRef: isSub ? null : order.gateway_ref, subscriptionRef: isSub ? order.gateway_ref : null, paymentId: body.razorpay_payment_id, signature: body.razorpay_signature });
  if (!verified) {
    logger.warn({ orderId: order.id }, "razorpay confirm with a signature that does not verify");
    throw badRequest("The payment could not be verified", "PAYMENT_NOT_VERIFIED");
  }
  if (order.status !== "PENDING" && order.status !== "FAILED" && order.status !== "EXPIRED") return presentOrder((await orderRepo.byId(order.id)) as OrderRow);
  const payment = await gateway.fetchPayment(body.razorpay_payment_id);
  if ((!isSub && payment.orderRef !== order.gateway_ref) || (isSub && payment.subscriptionRef && payment.subscriptionRef !== order.gateway_ref)) throw badRequest("The payment could not be verified", "PAYMENT_NOT_VERIFIED");
  if (payment.status === "CAPTURED") {
    const subscription = isSub ? await gateway.fetchSubscription(order.gateway_ref).catch(() => null) : null;
    await fulfilOrder(order.id, { amountMinor: payment.amountMinor, currency: payment.currency, paymentRef: body.razorpay_payment_id, subscriptionRef: isSub ? order.gateway_ref : null, subscription }, "confirm");
  }
  return presentOrder((await orderRepo.byId(order.id)) as OrderRow);
}

// ─── The learner's order ────────────────────────────────────────────────────

async function ownOrder(actor: Actor, orderId: string): Promise<OrderRow> {
  const order = await orderRepo.byId(orderId);
  if (!order || order.user_id !== actor.id) throw notFound("Order not found");
  return order;
}

/** The return page: `sync` asks Stripe about a still-PENDING order once, so it settles without waiting for the webhook. */
export async function getOrder(actor: Actor, orderId: string, sync: boolean): Promise<Order> {
  let order = await ownOrder(actor, orderId);
  if (sync && order.status === "PENDING" && order.gateway === "STRIPE") {
    await syncWithGateway(order, "return-page");
    order = (await orderRepo.byId(order.id)) as OrderRow;
  }
  return presentOrder(order);
}

export async function cancelOrder(actor: Actor, orderId: string): Promise<Order> {
  const order = await ownOrder(actor, orderId);
  if (order.status !== "PENDING") throw conflict("Only an unpaid order can be cancelled", "ORDER_NOT_PENDING", { status: order.status });
  if (!(await closeOrder(order.id, "CANCELED", "CANCELED_BY_BUYER", actor.id))) throw conflict("Only an unpaid order can be cancelled", "ORDER_NOT_PENDING");
  return presentOrder((await orderRepo.byId(order.id)) as OrderRow);
}
