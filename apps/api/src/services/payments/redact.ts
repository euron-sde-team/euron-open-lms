/**
 * Gateway webhook bodies are stored in payment_events for the order timeline and for
 * disputes, minus everything that identifies a card or a person: card details, emails,
 * phone numbers, addresses, UPI handles (vpa), bank accounts and wallets. Matching is by
 * key name at any depth, plus any string value that looks like an email address, so a
 * gateway adding a new contact field next year does not quietly leak it.
 *
 * Pure (test/unit/commerce-redact.test.ts).
 */

const SENSITIVE_KEYS = new Set([
  "card",
  "card_id",
  "cards",
  "last4",
  "fingerprint",
  "exp_month",
  "exp_year",
  "cvc",
  "cvv",
  "iin",
  "bank_account",
  "account_number",
  "ifsc",
  "vpa",
  "upi",
  "wallet",
  "email",
  "customer_email",
  "receipt_email",
  "billing_email",
  "phone",
  "customer_phone",
  "contact",
  "address",
  "billing_address",
  "shipping",
  "shipping_address",
  "shipping_details",
  "billing_details",
  "customer_details",
  "payment_method_details",
  "customer_name",
  "name_on_card",
]);

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const MAX_DEPTH = 12;

export const REDACTED = "[redacted]";

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === "string") return EMAIL.test(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) && v !== null ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** JSON for the payment_events.payload column, with PostgreSQL's forbidden \u0000 removed. */
export function redactedJson(value: unknown): string {
  return JSON.stringify(redact(value)).replace(/\\u0000/g, "");
}
