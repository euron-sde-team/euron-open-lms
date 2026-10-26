/**
 * Money on screen. Amounts arrive as integer minor units with their currency; Intl knows
 * each currency's decimals (JPY has none, KWD has three), so nothing here divides by 100.
 */
import type { Money } from "@open-lms/types";

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: "currency", currency, ...(compact ? { minimumFractionDigits: 0, maximumFractionDigits: 2 } : {}) });
    formatters.set(key, f);
  }
  return f;
}

/** Minor-unit exponent of a currency, from Intl (2 for USD, 0 for JPY, 3 for KWD). */
export function exponentOf(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** "$49.00", "₹4,999". `compact` drops ".00" on whole amounts (cards, plan prices). */
export function formatMoney(m: Money | null | undefined, opts: { compact?: boolean } = {}): string {
  if (!m) return "";
  const value = m.amountMinor / 10 ** exponentOf(m.currency);
  const compact = !!opts.compact && Number.isInteger(value);
  return formatter(m.currency, compact).format(value);
}

/** Major-unit input ("49.99") to minor units (4999) for a currency; null when not a number. */
export function toMinor(input: string, currency: string): number | null {
  const n = Number(input.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10 ** exponentOf(currency));
}

/** Minor units back to a major-unit string for an input field. */
export function toMajorString(amountMinor: number, currency: string): string {
  const e = exponentOf(currency);
  return (amountMinor / 10 ** e).toFixed(e);
}

/** "-25%" style saving between a price and its struck-through compare-at price. */
export function savingPercent(price: Money | null | undefined, compareAt: Money | null | undefined): number | null {
  if (!price || !compareAt || compareAt.amountMinor <= price.amountMinor || compareAt.currency !== price.currency) return null;
  return Math.round(((compareAt.amountMinor - price.amountMinor) * 100) / compareAt.amountMinor);
}
