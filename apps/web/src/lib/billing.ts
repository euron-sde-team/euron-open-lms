/**
 * Orders, subscriptions and plans in words. Pure, so each status has a test.
 */
import type { BillingInterval, Money, Order, OrderStatus, Plan, PlanPrice, SubscriptionSummary } from "@open-lms/types";
import { formatMoney } from "./money";

export const dateOnly = (iso: string | null | undefined, locale?: string) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso)) : "");

// ─── Orders ─────────────────────────────────────────────────────────────────

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "primary";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Awaiting payment", tone: "primary" },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  CANCELED: { label: "Canceled", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Partly refunded", tone: "warning" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

export const isPaidStatus = (s: OrderStatus) => s === "PAID" || s === "PARTIALLY_REFUNDED" || s === "REFUNDED";

/** "Course title", or "Course title and 2 more". */
export function orderTitle(o: Pick<Order, "lines" | "number">): string {
  const first = o.lines[0]?.title;
  if (!first) return o.number;
  return o.lines.length > 1 ? `${first} and ${o.lines.length - 1} more` : first;
}

/** Where "Back" goes from an order: the item's page. */
export function itemHref(line: Pick<Order["lines"][number], "type" | "slug"> | undefined): string {
  if (!line) return "/courses";
  if (line.type === "PLAN") return "/plans";
  if (!line.slug) return line.type === "BUNDLE" ? "/bundles" : "/courses";
  return `/${line.type === "BUNDLE" ? "bundles" : "courses"}/${encodeURIComponent(line.slug)}`;
}

// ─── The order (return) page ────────────────────────────────────────────────

export type OrderPhase = "loading" | "paid" | "failed" | "canceled" | "pending" | "timeout";

export const POLL_INTERVAL_MS = 2_000;
export const POLL_TIMEOUT_MS = 60_000;

/**
 * The return page's state from the latest order and how long it has been polling. A
 * PENDING order keeps polling for up to a minute, then says it is still processing.
 */
export function orderPhase(order: Pick<Order, "status"> | null | undefined, elapsedMs: number): OrderPhase {
  if (!order) return "loading";
  if (isPaidStatus(order.status)) return "paid";
  if (order.status === "FAILED" || order.status === "EXPIRED") return "failed";
  if (order.status === "CANCELED") return "canceled";
  return elapsedMs >= POLL_TIMEOUT_MS ? "timeout" : "pending";
}

/** The refetch interval for the order query: every 2 s while pending, then stop. */
export function pollInterval(order: Pick<Order, "status"> | null | undefined, elapsedMs: number): number | false {
  const phase = orderPhase(order, elapsedMs);
  return phase === "pending" || phase === "loading" ? POLL_INTERVAL_MS : false;
}

/** Failure reasons the API records, in words. */
export function failureCopy(reason: string | null | undefined): string {
  switch (reason) {
    case "GATEWAY_ERROR":
      return "The payment provider could not start the payment.";
    case "EXPIRED":
    case "CHECKOUT_EXPIRED":
      return "The checkout timed out before the payment finished.";
    case "CANCELED_BY_BUYER":
      return "You canceled the payment.";
    case "SUPERSEDED":
      return "A newer checkout replaced this one.";
    case null:
    case undefined:
    case "":
      return "The payment did not go through. You were not charged.";
    default:
      return /^[A-Z_]+$/.test(reason) ? "The payment did not go through. You were not charged." : reason;
  }
}

// ─── Subscription ───────────────────────────────────────────────────────────

export interface SubscriptionCopy {
  /** The status in words ("Active", "Free trial", "Payment overdue"). */
  status: string;
  tone: BadgeTone;
  /** "Renews on 12 Nov 2026", "Ends on ...", "Trial ends on ...". */
  dateLine: string | null;
  /** A warning paragraph with what to do (past due, incomplete). */
  warning: string | null;
  canCancel: boolean;
  canResume: boolean;
  /** Courses are open right now. */
  live: boolean;
}

export function subscriptionCopy(s: SubscriptionSummary, now: number = Date.now(), locale?: string): SubscriptionCopy {
  const end = s.currentPeriodEnd ? dateOnly(s.currentPeriodEnd, locale) : null;
  const trialEnd = s.trialEnd ? dateOnly(s.trialEnd, locale) : end;
  const price = `${formatMoney(s.price)} a ${s.interval === "YEAR" ? "year" : "month"}`;
  const future = !!s.currentPeriodEnd && new Date(s.currentPeriodEnd).getTime() > now;
  const base = { warning: null, canCancel: false, canResume: false, live: s.grantsAccess };
  switch (s.status) {
    case "TRIALING":
      return s.cancelAtPeriodEnd
        ? { ...base, status: "Free trial", tone: "primary", dateLine: trialEnd ? `Trial ends on ${trialEnd} and will not renew` : "Trial will not renew", canResume: true }
        : { ...base, status: "Free trial", tone: "primary", dateLine: trialEnd ? `Trial ends on ${trialEnd}, then ${price}` : `Then ${price}`, canCancel: true };
    case "ACTIVE":
      return s.cancelAtPeriodEnd
        ? { ...base, status: "Ending", tone: "warning", dateLine: end ? `Ends on ${end}` : null, canResume: true }
        : { ...base, status: "Active", tone: "success", dateLine: end ? `Renews on ${end} at ${price}` : `Renews at ${price}`, canCancel: true };
    case "PAST_DUE":
      return {
        ...base,
        status: "Payment overdue",
        tone: "danger",
        dateLine: end ? `The renewal on ${end} did not go through` : null,
        warning:
          "We could not take your last payment. Your courses stay open for a short grace period while we try again. Check that your card or bank account can pay, or pay from the reminder email we sent. If the payment keeps failing, the plan ends and your courses lock, though your progress is kept.",
        canCancel: !s.cancelAtPeriodEnd,
        canResume: s.cancelAtPeriodEnd,
      };
    case "INCOMPLETE":
      return { ...base, status: "Waiting for payment", tone: "neutral", dateLine: null, warning: "The first payment has not finished. If you closed the payment window, start again from Plans." };
    case "CANCELED":
      if (s.cancelAtPeriodEnd && future) return { ...base, status: "Ending", tone: "warning", dateLine: `Ends on ${end}`, canResume: true };
      return { ...base, status: future && s.grantsAccess ? "Canceled" : "Ended", tone: "neutral", dateLine: future && s.grantsAccess ? `Access until ${end}` : end ? `Ended on ${end}` : null };
    case "EXPIRED":
      return { ...base, status: "Ended", tone: "neutral", dateLine: end ? `Ended on ${end}` : null };
  }
}

/** What the cancel dialog says will happen. */
export function cancelExplainer(s: SubscriptionSummary, locale?: string): string {
  const end = s.status === "TRIALING" ? dateOnly(s.trialEnd ?? s.currentPeriodEnd, locale) : dateOnly(s.currentPeriodEnd, locale);
  if (s.status === "TRIALING") return `Your trial continues until ${end || "it ends"} and you will not be charged. After that, the courses in ${s.plan.name} lock. Your progress and certificates stay.`;
  return `You keep ${s.plan.name} until ${end || "the end of this billing period"} and will not be charged again. After that, its courses lock. Your progress and certificates stay, and you can resume before then.`;
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export interface PlanPricing {
  price: PlanPrice | null;
  /** Yearly: the price divided by 12, for "about X a month". */
  perMonth: Money | null;
  /** Yearly against twelve monthly payments, rounded down; null when there is no saving. */
  savingPercent: number | null;
  saving: Money | null;
}

export function planPricing(plan: Pick<Plan, "prices">, interval: BillingInterval): PlanPricing {
  const price = plan.prices.find((p) => p.interval === interval) ?? null;
  if (!price || interval === "MONTH") return { price, perMonth: null, savingPercent: null, saving: null };
  const perMonth = { amountMinor: Math.round(price.price.amountMinor / 12), currency: price.price.currency };
  const monthly = plan.prices.find((p) => p.interval === "MONTH" && p.price.currency === price.price.currency);
  if (!monthly) return { price, perMonth, savingPercent: null, saving: null };
  const twelve = monthly.price.amountMinor * 12;
  const diff = twelve - price.price.amountMinor;
  if (diff <= 0 || twelve <= 0) return { price, perMonth, savingPercent: null, saving: null };
  const pct = Math.floor((diff * 100) / twelve);
  return { price, perMonth, savingPercent: pct >= 1 ? pct : null, saving: { amountMinor: diff, currency: price.price.currency } };
}

/** The intervals this plan list sells in (for the toggle). */
export function availableIntervals(plans: Pick<Plan, "prices">[]): BillingInterval[] {
  const set = new Set(plans.flatMap((p) => p.prices.map((x) => x.interval)));
  return (["MONTH", "YEAR"] as const).filter((i) => set.has(i));
}
