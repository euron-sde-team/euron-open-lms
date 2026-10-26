/**
 * Checkout arithmetic, in integer minor units only. The order of operations is fixed:
 *   1. subtotal = sum of the price book amounts (never a client number);
 *   2. the coupon discounts the subtotal, spread across lines in proportion;
 *   3. tax applies to each discounted line: added on top (EXCLUSIVE) or carved out of
 *      the price (INCLUSIVE), rounded half-up per line so lines sum to the total.
 *
 * Pure (test/unit/pricing.test.ts).
 */
import type { CouponKind, TaxMode, TaxRule } from "@open-lms/types";

/** ISO 4217 minor-unit exponents that are not 2. Everything else has cents. */
const EXPONENTS: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, UGX: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3 };

export function minorExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/** Display/format helper for logs and PDFs: 499900 INR -> "4999.00". */
export function formatMinor(amountMinor: number, currency: string): string {
  const exp = minorExponent(currency);
  return exp === 0 ? String(amountMinor) : (amountMinor / 10 ** exp).toFixed(exp);
}

/** Half-up division of non-negative integers: round(a / b) without floats drifting. */
export function divRound(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

export interface PriceLine {
  key: string;
  unitMinor: number;
}

export interface CouponTerms {
  kind: CouponKind;
  percentOff: number | null;
  amountOffMinor: number | null;
  /** Which lines it applies to (all when undefined). */
  appliesTo?: (key: string) => boolean;
}

export interface TaxTerms {
  enabled: boolean;
  mode: TaxMode;
  rateBps: number;
  label: string | null;
}

export interface PricedLine {
  key: string;
  unitMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface Priced {
  lines: PricedLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxMode: TaxMode;
  taxRateBps: number;
  taxLabel: string | null;
}

/**
 * Spread `amount` over `weights` in proportion, largest remainder first, so the parts
 * are integers that sum exactly to `amount`.
 */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const parts = raw.map(Math.floor);
  let left = amount - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

export function couponDiscount(lines: PriceLine[], coupon: CouponTerms | null): number[] {
  if (!coupon) return lines.map(() => 0);
  const eligible = lines.map((l) => (coupon.appliesTo ? coupon.appliesTo(l.key) : true));
  const base = lines.map((l, i) => (eligible[i] ? l.unitMinor : 0));
  const eligibleTotal = base.reduce((a, b) => a + b, 0);
  if (eligibleTotal === 0) return lines.map(() => 0);
  const off =
    coupon.kind === "PERCENT"
      ? divRound(eligibleTotal * Math.min(100, Math.max(0, coupon.percentOff ?? 0)), 100)
      : Math.min(eligibleTotal, Math.max(0, coupon.amountOffMinor ?? 0));
  return allocate(off, base);
}

export function price(lines: PriceLine[], coupon: CouponTerms | null, tax: TaxTerms): Priced {
  const discounts = couponDiscount(lines, coupon);
  const rate = tax.enabled ? Math.max(0, tax.rateBps) : 0;
  const priced: PricedLine[] = lines.map((l, i) => {
    const net = l.unitMinor - discounts[i];
    if (rate === 0) return { key: l.key, unitMinor: l.unitMinor, discountMinor: discounts[i], taxMinor: 0, totalMinor: net };
    if (tax.mode === "EXCLUSIVE") {
      const t = divRound(net * rate, 10_000);
      return { key: l.key, unitMinor: l.unitMinor, discountMinor: discounts[i], taxMinor: t, totalMinor: net + t };
    }
    // Inclusive: the price already contains the tax. tax = net - net / (1 + rate).
    const t = net - divRound(net * 10_000, 10_000 + rate);
    return { key: l.key, unitMinor: l.unitMinor, discountMinor: discounts[i], taxMinor: t, totalMinor: net };
  });
  return {
    lines: priced,
    subtotalMinor: lines.reduce((a, l) => a + l.unitMinor, 0),
    discountMinor: priced.reduce((a, l) => a + l.discountMinor, 0),
    taxMinor: priced.reduce((a, l) => a + l.taxMinor, 0),
    totalMinor: priced.reduce((a, l) => a + l.totalMinor, 0),
    taxMode: tax.mode,
    taxRateBps: rate,
    taxLabel: rate ? tax.label : null,
  };
}

/** The rule for a buyer's country: an exact match, else "*", else none. */
export function taxRuleFor(rules: TaxRule[], country: string | null | undefined): TaxRule | null {
  const c = (country ?? "").toUpperCase();
  return rules.find((r) => r.country.toUpperCase() === c) ?? rules.find((r) => r.country === "*") ?? null;
}

/**
 * Why a coupon cannot be used right now, or null when it can. The checks that need the
 * database (per-user redemptions) are passed in as facts.
 */
export function couponProblem(
  c: { active: boolean; startsAt: Date | null; expiresAt: Date | null; maxRedemptions: number | null; redemptionCount: number; perUserLimit: number; kind: CouponKind; currency: string | null },
  ctx: { now: Date; currency: string; userRedemptions: number; applicableLines: number },
): "EXPIRED" | "NOT_STARTED" | "EXHAUSTED" | "NOT_APPLICABLE" | "CURRENCY_MISMATCH" | "ALREADY_USED" | null {
  if (!c.active) return "EXPIRED";
  if (c.startsAt && c.startsAt > ctx.now) return "NOT_STARTED";
  if (c.expiresAt && c.expiresAt <= ctx.now) return "EXPIRED";
  if (c.maxRedemptions !== null && c.redemptionCount >= c.maxRedemptions) return "EXHAUSTED";
  if (ctx.userRedemptions >= c.perUserLimit) return "ALREADY_USED";
  if (c.kind === "FIXED" && c.currency !== ctx.currency) return "CURRENCY_MISMATCH";
  if (ctx.applicableLines === 0) return "NOT_APPLICABLE";
  return null;
}
