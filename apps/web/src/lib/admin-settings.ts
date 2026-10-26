/**
 * The settings page as pure pieces: each section maps the LmsSettings document to a form
 * value, validates it, and turns it back into the PATCH for its own groups. Tested in
 * test/admin/settings.test.ts.
 */
import type { LmsSettings, TaxRule } from "@open-lms/types";
import type { AdminSettingsPatch } from "@open-lms/api-client";
import { countChanges, settingsDiff } from "./admin";

export type Errors = Record<string, string>;

export interface SectionDef<F> {
  toForm: (s: LmsSettings) => F;
  validate: (f: F) => Errors;
  toPatch: (f: F) => AdminSettingsPatch;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const intIn = (v: string, min: number, max: number) => /^-?\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

/** Whether the form differs from what is saved. */
export function isDirty<F>(def: SectionDef<F>, base: LmsSettings, form: F): boolean {
  return !same(def.toForm(base), form);
}

/** How many fields changed (for the "2 changes" hint next to Save). */
export function changeCount<F>(def: SectionDef<F>, base: LmsSettings, form: F): number {
  const diff = settingsDiff(def.toForm(base) as Record<string, unknown>, form as Record<string, unknown>);
  return Object.keys(diff).length ? countChanges(diff) : 0;
}

// ─── Academy ────────────────────────────────────────────────────────────────

export interface AcademyForm {
  academyName: string;
  tagline: string;
  logoUploadId: string | null;
  registration: "OPEN" | "CLOSED";
  supportEmail: string;
}

export const academySection: SectionDef<AcademyForm> = {
  toForm: (s) => ({ academyName: s.academyName, tagline: s.tagline, logoUploadId: s.logoUploadId, registration: s.registration, supportEmail: s.supportEmail ?? "" }),
  validate: (f) => {
    const e: Errors = {};
    const name = f.academyName.trim();
    if (!name) e.academyName = "Give the academy a name.";
    else if (name.length > 80) e.academyName = "At most 80 characters.";
    if (f.tagline.trim().length > 160) e.tagline = "At most 160 characters.";
    if (f.supportEmail.trim() && !EMAIL.test(f.supportEmail.trim())) e.supportEmail = "Enter an email address, or leave it empty.";
    return e;
  },
  toPatch: (f) => ({ academyName: f.academyName.trim(), tagline: f.tagline.trim(), logoUploadId: f.logoUploadId, registration: f.registration, supportEmail: f.supportEmail.trim() || null }),
};

// ─── Currencies and payments ────────────────────────────────────────────────

export type Gateway = "STRIPE" | "RAZORPAY";
export interface CurrencyForm {
  enabled: string[];
  default: string;
  routing: Record<string, Gateway>;
  fallback: Gateway;
}

/** A curated list of ISO 4217 codes the picker offers (enabled codes outside it are kept). */
export const CURRENCY_CHOICES = [
  "USD", "EUR", "GBP", "INR", "CAD", "AUD", "NZD", "SGD", "HKD", "JPY", "CNY", "KRW", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON",
  "TRY", "ILS", "AED", "SAR", "QAR", "KWD", "BHD", "EGP", "NGN", "KES", "ZAR", "BRL", "MXN", "ARS", "CLP", "COP", "PEN", "IDR", "MYR", "PHP",
  "THB", "VND", "PKR", "BDT", "LKR", "NPR",
] as const;

export const currencySection: SectionDef<CurrencyForm> = {
  toForm: (s) => ({ enabled: [...s.currencies.enabled], default: s.currencies.default, routing: { ...s.gateways.routing }, fallback: s.gateways.fallback }),
  validate: (f) => {
    const e: Errors = {};
    if (!f.enabled.length) e.enabled = "Enable at least one currency.";
    else if (f.enabled.length > 20) e.enabled = "At most 20 currencies.";
    if (!f.enabled.includes(f.default)) e.default = "The default currency must be one of the enabled ones.";
    return e;
  },
  toPatch: (f) => ({
    currencies: { enabled: f.enabled, default: f.default },
    // Only enabled currencies are routed; the rest fall back.
    gateways: { routing: Object.fromEntries(f.enabled.filter((c) => f.routing[c]).map((c) => [c, f.routing[c]!])), fallback: f.fallback },
  }),
};

/** Toggle a currency on or off, keeping the default valid and the order stable. */
export function toggleCurrency(f: CurrencyForm, code: string): CurrencyForm {
  const on = f.enabled.includes(code);
  const enabled = on ? f.enabled.filter((c) => c !== code) : [...f.enabled, code];
  const def = enabled.includes(f.default) ? f.default : (enabled[0] ?? f.default);
  return { ...f, enabled, default: def };
}

// ─── Tax ────────────────────────────────────────────────────────────────────

export interface TaxRuleForm {
  country: string;
  /** Percent as typed ("18" or "7.5"). */
  rate: string;
  label: string;
}
export interface TaxForm {
  enabled: boolean;
  mode: "EXCLUSIVE" | "INCLUSIVE";
  rules: TaxRuleForm[];
}

/** 1800 basis points to "18"; 750 to "7.5". */
export function bpsToPercent(bps: number): string {
  return String(Math.round(bps) / 100);
}

/** "7.5" to 750; null when not a percentage between 0 and 100 with at most two decimals. */
export function percentToBps(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 100 ? Math.round(n * 100) : null;
}

export const taxSection: SectionDef<TaxForm> = {
  toForm: (s) => ({ enabled: s.tax.enabled, mode: s.tax.mode, rules: s.tax.rules.map((r) => ({ country: r.country, rate: bpsToPercent(r.rateBps), label: r.label })) }),
  validate: (f) => {
    const e: Errors = {};
    const seen = new Set<string>();
    f.rules.forEach((r, i) => {
      const c = r.country.trim().toUpperCase();
      if (!/^(\*|[A-Z]{2})$/.test(c)) e[`rules.${i}.country`] = 'A two-letter country code, or "*" for everywhere else.';
      else if (seen.has(c)) e[`rules.${i}.country`] = "Each country once.";
      seen.add(c);
      if (percentToBps(r.rate) === null) e[`rules.${i}.rate`] = "A percentage from 0 to 100.";
      if (!r.label.trim()) e[`rules.${i}.label`] = "Name the tax (for example VAT or GST).";
      else if (r.label.trim().length > 40) e[`rules.${i}.label`] = "At most 40 characters.";
    });
    if (f.rules.length > 250) e.rules = "At most 250 rules.";
    if (f.enabled && !f.rules.length) e.rules = "Add at least one rule, or turn tax off.";
    return e;
  },
  toPatch: (f) => ({
    tax: { enabled: f.enabled, mode: f.mode, rules: f.rules.map((r): TaxRule => ({ country: r.country.trim().toUpperCase(), rateBps: percentToBps(r.rate) ?? 0, label: r.label.trim() })) },
  }),
};

// ─── Seller ─────────────────────────────────────────────────────────────────

export interface SellerForm {
  legalName: string;
  address: string;
  taxId: string;
  email: string;
}
export const sellerSection: SectionDef<SellerForm> = {
  toForm: (s) => ({ legalName: s.seller.legalName, address: s.seller.address, taxId: s.seller.taxId ?? "", email: s.seller.email ?? "" }),
  validate: (f) => {
    const e: Errors = {};
    if (!f.legalName.trim()) e.legalName = "The legal name printed on invoices.";
    else if (f.legalName.trim().length > 200) e.legalName = "At most 200 characters.";
    if (f.address.trim().length > 500) e.address = "At most 500 characters.";
    if (f.taxId.trim().length > 60) e.taxId = "At most 60 characters.";
    if (f.email.trim() && !EMAIL.test(f.email.trim())) e.email = "Enter an email address, or leave it empty.";
    return e;
  },
  toPatch: (f) => ({ seller: { legalName: f.legalName.trim(), address: f.address.trim(), taxId: f.taxId.trim() || null, email: f.email.trim() || null } }),
};

// ─── Learning ───────────────────────────────────────────────────────────────

export interface LearningForm {
  videoCompletePercent: string;
  reviewMinProgressPercent: string;
  subscriptionGraceDays: string;
  orderTtlMinutes: string;
}
export const learningSection: SectionDef<LearningForm> = {
  toForm: (s) => ({
    videoCompletePercent: String(s.learning.videoCompletePercent),
    reviewMinProgressPercent: String(s.learning.reviewMinProgressPercent),
    subscriptionGraceDays: String(s.learning.subscriptionGraceDays),
    orderTtlMinutes: String(s.learning.orderTtlMinutes),
  }),
  validate: (f) => {
    const e: Errors = {};
    if (!intIn(f.videoCompletePercent, 1, 100)) e.videoCompletePercent = "A whole number from 1 to 100.";
    if (!intIn(f.reviewMinProgressPercent, 1, 100)) e.reviewMinProgressPercent = "A whole number from 1 to 100.";
    if (!intIn(f.subscriptionGraceDays, 0, 30)) e.subscriptionGraceDays = "A whole number from 0 to 30.";
    if (!intIn(f.orderTtlMinutes, 5, 1440)) e.orderTtlMinutes = "A whole number from 5 to 1440.";
    return e;
  },
  toPatch: (f) => ({
    learning: {
      videoCompletePercent: Number(f.videoCompletePercent),
      reviewMinProgressPercent: Number(f.reviewMinProgressPercent),
      subscriptionGraceDays: Number(f.subscriptionGraceDays),
      orderTtlMinutes: Number(f.orderTtlMinutes),
    },
  }),
};

// ─── Certificates ───────────────────────────────────────────────────────────

export type CertificatesForm = LmsSettings["certificates"];
export const certificatesSection: SectionDef<CertificatesForm> = {
  toForm: (s) => ({ ...s.certificates }),
  validate: (f) => {
    const e: Errors = {};
    if (f.signatoryName.trim().length > 80) e.signatoryName = "At most 80 characters.";
    if (f.signatoryTitle.trim().length > 80) e.signatoryTitle = "At most 80 characters.";
    if (f.footer.trim().length > 300) e.footer = "At most 300 characters.";
    return e;
  },
  toPatch: (f) => ({ certificates: { signatoryName: f.signatoryName.trim(), signatoryTitle: f.signatoryTitle.trim(), footer: f.footer.trim() } }),
};

// ─── Analytics ──────────────────────────────────────────────────────────────

export interface AnalyticsForm {
  timezone: string;
}

/** Every IANA zone the browser knows (UTC first). */
export function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (k: string) => string[] };
  const list = intl.supportedValuesOf?.("timeZone") ?? [];
  return ["UTC", ...list.filter((z) => z !== "UTC")];
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return !!tz.trim();
  } catch {
    return false;
  }
}

export const analyticsSection: SectionDef<AnalyticsForm> = {
  toForm: (s) => ({ timezone: s.analytics.timezone }),
  validate: (f): Errors => (isTimeZone(f.timezone.trim()) ? {} : { timezone: "Pick a time zone from the list, for example Europe/Berlin." }),
  toPatch: (f) => ({ analytics: { timezone: f.timezone.trim() } }),
};

/** API field errors ("tax.rules.0.label") to this section's form keys. */
export function mapFieldErrors(fieldErrors: Record<string, string>, groups: string[]): Errors {
  const out: Errors = {};
  for (const [path, msg] of Object.entries(fieldErrors)) {
    const parts = path.split(".");
    const key = groups.includes(parts[0]!) && parts.length > 1 ? parts.slice(1).join(".") : path;
    out[key] = msg.charAt(0).toUpperCase() + msg.slice(1);
  }
  return out;
}
