/**
 * The subscription lifecycle, driven by verified gateway events and by the learner's or
 * an operator's cancel. States (subscription_status):
 *
 *   INCOMPLETE  created when a plan checkout starts; the first payment (fulfilment)
 *               moves it to TRIALING or ACTIVE. Gateway events alone never activate it:
 *               only a payment whose amount matched the order does.
 *   TRIALING / ACTIVE   period dates come from the gateway's events.
 *   PAST_DUE    a renewal failed (notify SUBSCRIPTION_PAYMENT_FAILED); access continues
 *               for settings.learning.subscriptionGraceDays.
 *   CANCELED    with cancel_at_period_end: stops renewing, access until the paid period
 *               ends; without it: ended at the gateway, access ends now.
 *   EXPIRED     set by billing.expire-subscriptions after the period (plus grace) ends.
 *
 * Renewals create an order of kind SUBSCRIPTION, PAID, with its own invoice; the
 * idempotency key "renewal:<gateway invoice or payment id>" makes a redelivered renewal
 * a no-op. Access itself is never written: domain/entitlements.ts reads this row.
 */
import type { SubscriptionStatus, SubscriptionSummary } from "@open-lms/types";
import { randomBytes } from "node:crypto";
import type { Actor } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { captureError } from "../core/logger";
import { db } from "../db/kysely";
import { orderNumber, sourcesOf } from "../domain/orders";
import { price } from "../domain/pricing";
import { liveSubscriptionOf } from "../presenters/subscription.presenter";
import { orderRepo } from "../repositories/order.repository";
import { priceRepo } from "../repositories/price.repository";
import { LIVE_STATUSES, subscriptionRepo, type SubscriptionRow } from "../repositories/subscription.repository";
import { audit } from "./audit.service";
import { issueInvoice, orderTax } from "./invoice.service";
import { notify } from "./notification.service";
import type { NormalizedEvent } from "./payments/gateway";
import { gatewayOf } from "./payments/gateways";
import { fulfilOrder } from "./payments/fulfilment.service";
import { getSettings } from "./settings.service";

/** Find our row for a gateway subscription event: by its id, or by the id we put in its metadata. */
export async function resolveSubscription(e: NormalizedEvent): Promise<SubscriptionRow | undefined> {
  if (e.subscriptionRef) {
    const byRef = await subscriptionRepo.byRef(e.gateway, e.subscriptionRef);
    if (byRef) return byRef;
  }
  if (e.localSubscriptionId) {
    const byId = await subscriptionRepo.byId(e.localSubscriptionId);
    if (byId && byId.gateway === e.gateway) {
      // The Stripe subscription id is first learned here; record it once.
      if (e.subscriptionRef && byId.gateway_subscription_ref.startsWith("pending_")) await subscriptionRepo.setRef(byId.id, e.subscriptionRef, db);
      return { ...byId, gateway_subscription_ref: e.subscriptionRef ?? byId.gateway_subscription_ref };
    }
  }
  return undefined;
}

/** A hard-ended row (cancelled at the gateway, not just scheduled) or EXPIRED: later status events cannot revive it. */
function terminal(sub: SubscriptionRow): boolean {
  return sub.status === "EXPIRED" || (sub.status === "CANCELED" && !sub.cancel_at_period_end);
}

export async function onSubscriptionUpdated(e: NormalizedEvent): Promise<{ outcome: string; subscriptionId: string | null }> {
  const sub = await resolveSubscription(e);
  if (!sub) return { outcome: "SUBSCRIPTION_NOT_FOUND", subscriptionId: null };
  if (sub.status === "INCOMPLETE") return { outcome: "AWAITING_FIRST_PAYMENT", subscriptionId: sub.id };
  if (terminal(sub)) return { outcome: "IGNORED_TERMINAL", subscriptionId: sub.id };
  const status = e.subscriptionStatus ?? sub.status;
  if (status === "INCOMPLETE") return { outcome: "IGNORED", subscriptionId: sub.id };
  const cancelAtPeriodEnd = e.cancelAtPeriodEnd ?? sub.cancel_at_period_end;
  const moved = await subscriptionRepo.update(
    sub.id,
    ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"],
    {
      status,
      current_period_start: e.periodStart ?? sub.current_period_start,
      current_period_end: e.periodEnd ?? sub.current_period_end,
      trial_end: e.trialEnd ?? (status === "TRIALING" ? sub.trial_end : null),
      cancel_at_period_end: status === "CANCELED" ? cancelAtPeriodEnd : false,
      canceled_at: status === "CANCELED" ? (sub.canceled_at ?? new Date()) : null,
    },
    db,
  );
  return { outcome: moved ? `STATUS_${status}` : "NOT_UPDATED", subscriptionId: sub.id };
}

/**
 * A recurring charge succeeded. The first one may be how we learn the first payment
 * (the checkout event got lost), so it is routed through fulfilment; later ones are
 * renewals.
 */
export async function onRenewed(e: NormalizedEvent): Promise<{ outcome: string; subscriptionId: string | null; orderId: string | null }> {
  const sub = await resolveSubscription(e);
  if (!sub) return { outcome: "SUBSCRIPTION_NOT_FOUND", subscriptionId: null, orderId: null };
  const first = sub.first_order_id ? await orderRepo.byId(sub.first_order_id) : undefined;
  const period = { status: e.subscriptionStatus, periodStart: e.periodStart, periodEnd: e.periodEnd, trialEnd: e.trialEnd };
  if (first && sourcesOf("PAID").includes(first.status)) {
    const r = await fulfilOrder(first.id, { amountMinor: e.amountMinor ?? -1, currency: e.currency ?? "", paymentRef: e.paymentRef, subscriptionRef: sub.gateway_subscription_ref, subscription: period }, "webhook");
    return { outcome: r.outcome, subscriptionId: sub.id, orderId: first.id };
  }
  const isFirstCharge = e.billingReason === "subscription_create" || (!!e.paymentRef && first?.gateway_payment_ref === e.paymentRef);
  if (isFirstCharge) {
    if (e.periodEnd && !terminal(sub)) await subscriptionRepo.update(sub.id, ["TRIALING", "ACTIVE", "PAST_DUE"], { current_period_start: e.periodStart ?? sub.current_period_start, current_period_end: e.periodEnd }, db);
    return { outcome: "FIRST_PAYMENT_ALREADY_FULFILLED", subscriptionId: sub.id, orderId: first?.id ?? null };
  }
  return renew(sub, e);
}

async function renew(sub: SubscriptionRow, e: NormalizedEvent): Promise<{ outcome: string; subscriptionId: string; orderId: string | null }> {
  const key = `renewal:${(e.invoiceRef ?? e.paymentRef ?? e.id).slice(0, 180)}`;
  return withTransaction(async (trx, fx) => {
    const locked = (await subscriptionRepo.lock(sub.id, trx)) as SubscriptionRow;
    const existing = await orderRepo.byIdempotencyKey(locked.user_id, key, trx);
    if (existing) return { outcome: "DUPLICATE_RENEWAL", subscriptionId: sub.id, orderId: existing.id };
    if (terminal(locked)) return { outcome: "IGNORED_TERMINAL", subscriptionId: sub.id, orderId: null };
    // Never trust the event for the amount: a renewal must charge what the subscription costs.
    if (e.amountMinor !== locked.amount_minor || (e.currency ?? "").toUpperCase() !== locked.currency) {
      await audit({ actorId: null, action: "subscription.renewal_amount_mismatch", entityType: "subscription", entityId: sub.id, data: { expected: { amountMinor: locked.amount_minor, currency: locked.currency }, captured: { amountMinor: e.amountMinor, currency: e.currency }, paymentRef: e.paymentRef } }, trx);
      return { outcome: "AMOUNT_MISMATCH", subscriptionId: sub.id, orderId: null };
    }
    const first = locked.first_order_id ? await orderRepo.byId(locked.first_order_id, trx) : undefined;
    const plan = await trx.selectFrom("plans").select(["id", "name"]).where("id", "=", locked.plan_id).executeTakeFirstOrThrow();
    const row = locked.price_id ? await priceRepo.byId(locked.price_id, trx) : undefined;
    let tax = first ? orderTax(first) : { mode: "EXCLUSIVE" as const, rateBps: 0, label: null };
    let priced = price([{ key: "plan", unitMinor: row?.amount_minor ?? locked.amount_minor }], null, { enabled: tax.rateBps > 0, mode: tax.mode, rateBps: tax.rateBps, label: tax.label });
    if (priced.totalMinor !== locked.amount_minor) {
      tax = { mode: "EXCLUSIVE", rateBps: 0, label: null };
      priced = price([{ key: "plan", unitMinor: locked.amount_minor }], null, { enabled: false, mode: "EXCLUSIVE", rateBps: 0, label: null });
    }
    const line = priced.lines[0];
    const orderId = newId();
    const now = new Date();
    await trx
      .insertInto("orders")
      .values({
        id: orderId,
        number: orderNumber(randomBytes(8)),
        user_id: locked.user_id,
        kind: "SUBSCRIPTION",
        status: "PAID",
        currency: locked.currency,
        subtotal_minor: priced.subtotalMinor,
        discount_minor: 0,
        tax_minor: priced.taxMinor,
        total_minor: priced.totalMinor,
        gateway: locked.gateway,
        gateway_payment_ref: e.paymentRef,
        tax: JSON.stringify(tax),
        billing: JSON.stringify(first?.billing ?? {}),
        plan_id: locked.plan_id,
        price_id: locked.price_id,
        idempotency_key: key,
        paid_at: now,
        expires_at: now,
      })
      .execute();
    const item = { id: newId(), order_id: orderId, sellable_type: "PLAN" as const, sellable_id: plan.id, title: `${plan.name} (renewal)`, price_id: locked.price_id, unit_minor: line.unitMinor, discount_minor: 0, tax_minor: line.taxMinor, total_minor: line.totalMinor };
    await trx.insertInto("order_items").values(item).execute();
    const periodEnd = e.periodEnd ?? new Date((locked.current_period_end ?? now).getTime() + (locked.interval === "YEAR" ? 365 : 30) * 86_400_000);
    await subscriptionRepo.update(sub.id, ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"], { status: "ACTIVE", current_period_start: e.periodStart ?? locked.current_period_end ?? now, current_period_end: periodEnd, trial_end: null }, trx);
    const order = (await orderRepo.byId(orderId, trx))!;
    const invoice = await issueInvoice(order, [item], trx, { subscriptionId: sub.id });
    await notify({ recipientId: locked.user_id, actorId: null, type: "SUBSCRIPTION_RENEWED", entityType: "subscription", entityId: sub.id, snippet: plan.name, data: { orderId } }, fx, trx);
    fx.job("invoices.render", { invoiceId: invoice.id });
    fx.job("notify.receipt", { orderId });
    return { outcome: "RENEWED", subscriptionId: sub.id, orderId };
  });
}

export async function onPaymentFailed(e: NormalizedEvent): Promise<{ outcome: string; subscriptionId: string | null }> {
  const sub = await resolveSubscription(e);
  if (!sub) return { outcome: "SUBSCRIPTION_NOT_FOUND", subscriptionId: null };
  return withTransaction(async (trx, fx) => {
    const moved = await subscriptionRepo.update(sub.id, ["TRIALING", "ACTIVE"], { status: "PAST_DUE" }, trx);
    if (!moved) return { outcome: `IGNORED_${sub.status}`, subscriptionId: sub.id };
    const plan = await trx.selectFrom("plans").select("name").where("id", "=", sub.plan_id).executeTakeFirst();
    await notify({ recipientId: sub.user_id, actorId: null, type: "SUBSCRIPTION_PAYMENT_FAILED", entityType: "subscription", entityId: sub.id, snippet: plan?.name ?? null }, fx, trx);
    return { outcome: "PAST_DUE", subscriptionId: sub.id };
  });
}

/** The gateway ended the subscription: access stops now (or at the end the gateway reports, if sooner). */
export async function onCanceled(e: NormalizedEvent): Promise<{ outcome: string; subscriptionId: string | null }> {
  const sub = await resolveSubscription(e);
  if (!sub) return { outcome: "SUBSCRIPTION_NOT_FOUND", subscriptionId: null };
  return withTransaction(async (trx, fx) => {
    const now = new Date();
    const ended = e.periodEnd && e.periodEnd < now ? e.periodEnd : now;
    const end = sub.current_period_end && sub.current_period_end < ended ? sub.current_period_end : ended;
    const moved = await subscriptionRepo.update(sub.id, ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"], { status: "CANCELED", cancel_at_period_end: false, canceled_at: sub.canceled_at ?? now, current_period_end: end }, trx);
    if (!moved) return { outcome: `IGNORED_${sub.status}`, subscriptionId: sub.id };
    if (sub.status !== "CANCELED" && sub.status !== "INCOMPLETE") {
      const plan = await trx.selectFrom("plans").select("name").where("id", "=", sub.plan_id).executeTakeFirst();
      await notify({ recipientId: sub.user_id, actorId: null, type: "SUBSCRIPTION_CANCELED", entityType: "subscription", entityId: sub.id, snippet: plan?.name ?? null }, fx, trx);
    }
    return { outcome: "CANCELED", subscriptionId: sub.id };
  });
}

// ─── Cancel and resume ──────────────────────────────────────────────────────

/**
 * Stop a subscription. At period end (the learner's choice, and the admin default):
 * no more renewals, access until the paid period ends. Immediately (admin only): ends
 * at the gateway now and access stops now. The gateway is asked first; the row follows.
 */
export async function cancelSubscription(sub: SubscriptionRow, actor: Actor, opts: { atPeriodEnd: boolean; ip?: string | null }): Promise<void> {
  if (!(["TRIALING", "ACTIVE", "PAST_DUE"] as SubscriptionStatus[]).includes(sub.status) && !(sub.status === "CANCELED" && sub.cancel_at_period_end && !opts.atPeriodEnd)) {
    throw conflict("This subscription is not active", "SUBSCRIPTION_NOT_ACTIVE");
  }
  if (sub.gateway === "FREE" || sub.gateway_subscription_ref.startsWith("pending_")) throw conflict("This subscription is not active", "SUBSCRIPTION_NOT_ACTIVE");
  await gatewayOf(sub.gateway).cancelSubscription(sub.gateway_subscription_ref, { atPeriodEnd: opts.atPeriodEnd });
  await withTransaction(async (trx, fx) => {
    const now = new Date();
    const set = opts.atPeriodEnd
      ? { status: "CANCELED" as const, cancel_at_period_end: true, canceled_at: now }
      : { status: "CANCELED" as const, cancel_at_period_end: false, canceled_at: now, current_period_end: sub.current_period_end && sub.current_period_end < now ? sub.current_period_end : now };
    const moved = await subscriptionRepo.update(sub.id, ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"], set, trx);
    if (!moved) throw conflict("This subscription changed meanwhile; reload and try again", "SUBSCRIPTION_CHANGED");
    await audit({ actorId: actor.id, action: "subscription.cancel", entityType: "subscription", entityId: sub.id, ip: opts.ip ?? null, data: { atPeriodEnd: opts.atPeriodEnd, userId: sub.user_id } }, trx);
    const plan = await trx.selectFrom("plans").select("name").where("id", "=", sub.plan_id).executeTakeFirst();
    await notify({ recipientId: sub.user_id, actorId: actor.id, type: "SUBSCRIPTION_CANCELED", entityType: "subscription", entityId: sub.id, snippet: plan?.name ?? null }, fx, trx);
  });
}

/** The learner's own cancel: always at period end. */
export async function cancelMine(actor: Actor, ip: string | null): Promise<SubscriptionSummary> {
  const sub = await subscriptionRepo.current(actor.id);
  if (!sub || sub.status === "INCOMPLETE" || sub.status === "CANCELED") throw conflict("You have no active subscription to cancel", "SUBSCRIPTION_NOT_ACTIVE");
  await cancelSubscription(sub, actor, { atPeriodEnd: true, ip });
  return (await liveSubscriptionOf(actor.id)) as SubscriptionSummary;
}

/** Undo a pending cancel while the paid period is still running. */
export async function resumeMine(actor: Actor, ip: string | null): Promise<SubscriptionSummary> {
  const sub = await subscriptionRepo.current(actor.id);
  if (!sub || sub.status !== "CANCELED" || !sub.cancel_at_period_end || !sub.current_period_end || sub.current_period_end <= new Date()) {
    throw conflict("There is no pending cancellation to undo", "NOTHING_TO_RESUME");
  }
  await gatewayOf(sub.gateway as "STRIPE" | "RAZORPAY").resumeSubscription(sub.gateway_subscription_ref);
  await withTransaction(async (trx) => {
    const status: SubscriptionStatus = sub.trial_end && sub.trial_end > new Date() ? "TRIALING" : "ACTIVE";
    // The gateway's own "updated" event may have landed first and already moved the row back.
    const moved = await subscriptionRepo.update(sub.id, ["CANCELED", "ACTIVE", "TRIALING"], { status, cancel_at_period_end: false, canceled_at: null }, trx);
    if (!moved) throw conflict("This subscription changed meanwhile; reload and try again", "SUBSCRIPTION_CHANGED");
    await audit({ actorId: actor.id, action: "subscription.resume", entityType: "subscription", entityId: sub.id, ip }, trx);
  });
  return (await liveSubscriptionOf(actor.id)) as SubscriptionSummary;
}

// ─── Expiry ─────────────────────────────────────────────────────────────────

/**
 * billing.expire-subscriptions: rows whose period plus grace is over become EXPIRED.
 * A row that still looks live is checked with the gateway first, in case a renewal
 * webhook was lost: a later period end from the gateway is kept instead of expiring.
 */
export async function expireSubscriptions(batch = 200): Promise<{ expired: number }> {
  const { learning } = await getSettings();
  const due = await subscriptionRepo.dueToExpire(learning.subscriptionGraceDays, batch);
  let expired = 0;
  for (const sub of due) {
    try {
      if (sub.status !== "CANCELED" && sub.gateway !== "FREE" && !sub.gateway_subscription_ref.startsWith("pending_")) {
        const live = await gatewayOf(sub.gateway).fetchSubscription(sub.gateway_subscription_ref).catch(() => null);
        if (live?.periodEnd && live.periodEnd > new Date() && LIVE_STATUSES.includes(live.status)) {
          await subscriptionRepo.update(sub.id, [sub.status], { status: live.status, current_period_start: live.periodStart, current_period_end: live.periodEnd }, db);
          continue;
        }
      }
      if (await subscriptionRepo.update(sub.id, ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"], { status: "EXPIRED" }, db)) expired += 1;
    } catch (err) {
      captureError(err, { where: "expireSubscriptions", subscriptionId: sub.id });
    }
  }
  return { expired };
}

export async function subscriptionOrThrow(id: string): Promise<SubscriptionRow> {
  const sub = await subscriptionRepo.byId(id);
  if (!sub) throw notFound("Subscription not found");
  return sub;
}
