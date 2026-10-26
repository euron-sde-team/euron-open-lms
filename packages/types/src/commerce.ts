/** Checkout, orders, subscriptions, invoices and refunds. Re-exported from index.ts. */
import type { Money } from "./index";

export type SellableType = "COURSE" | "BUNDLE" | "PLAN";
export type BillingInterval = "MONTH" | "YEAR";
export type GatewayName = "STRIPE" | "RAZORPAY" | "FREE";
export type OrderKind = "ONE_TIME" | "SUBSCRIPTION";
export type OrderStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELED" | "PARTIALLY_REFUNDED" | "REFUNDED";
export type RefundStatus = "PENDING" | "SUCCEEDED" | "FAILED";
export type CouponKind = "PERCENT" | "FIXED";
export type CouponScope = "ALL" | "COURSES" | "BUNDLES" | "PLANS" | "SPECIFIC";
export type SubscriptionStatus = "INCOMPLETE" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
export type TaxMode = "EXCLUSIVE" | "INCLUSIVE";

// ─── Plans ──────────────────────────────────────────────────────────────────

export interface PlanPrice {
  id: string;
  interval: BillingInterval;
  price: Money;
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string;
  features: string[];
  trialDays: number;
  /** In the requested currency; empty when the plan is not sold in it. */
  prices: PlanPrice[];
  includedCourseCount: number;
}

export interface SubscriptionSummary {
  id: string;
  plan: { id: string; slug: string; name: string };
  status: SubscriptionStatus;
  interval: BillingInterval;
  price: Money;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  gateway: GatewayName;
  /** True while the subscription unlocks courses (active, trialing, or within the grace period). */
  grantsAccess: boolean;
}

// ─── Checkout ───────────────────────────────────────────────────────────────

/** POST /api/checkout/quote and the summary on the checkout page. */
export interface CheckoutQuoteRequest {
  item: { type: SellableType; id: string; interval?: BillingInterval };
  currency: string;
  couponCode?: string;
  billing?: BillingDetails;
}

export interface BillingDetails {
  name: string;
  country: string;
  region?: string;
  taxId?: string;
  addressLine?: string;
  postalCode?: string;
}

export interface QuoteLine {
  type: SellableType;
  id: string;
  title: string;
  unit: Money;
  discount: Money;
  tax: Money;
  total: Money;
}

export interface CheckoutQuote {
  currency: string;
  lines: QuoteLine[];
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
  taxLabel: string | null;
  taxMode: TaxMode;
  coupon: { code: string; description: string | null; kind: CouponKind; percentOff: number | null; amountOff: Money | null } | null;
  /** Why a coupon the learner typed does not apply (stable codes for the coupon chip). */
  couponError: "NOT_FOUND" | "EXPIRED" | "NOT_STARTED" | "EXHAUSTED" | "NOT_APPLICABLE" | "CURRENCY_MISMATCH" | "ALREADY_USED" | null;
  gateway: GatewayName;
  kind: OrderKind;
  /** Subscriptions: what renewals cost after any first-payment coupon. */
  recurring: { price: Money; interval: BillingInterval; trialDays: number } | null;
  /** Already owns everything in the quote (blocks checkout). */
  alreadyOwned: boolean;
}

export interface CheckoutStartRequest extends CheckoutQuoteRequest {
  /** One per click: a retried request returns the same order instead of a second one. */
  idempotencyKey: string;
  /**
   * Stripe only: where the hosted checkout sends the buyer back, instead of the web
   * order page. The mobile app sends `<web origin>/checkout/app-return?app=openlms`, an
   * https page that hands off to `openlms://checkout/return`; an app link in
   * MOBILE_RETURN_SCHEMES is also accepted (the stub flow). `orderId` and `session_id`
   * (or `canceled=1`) are appended.
   */
  returnUrl?: string;
}

/**
 * How the browser hands off to the gateway. The browser never learns an amount it
 * could change: everything was priced on the server and fixed on the order.
 */
export type CheckoutHandoff =
  /** Stripe Checkout (and the local stub): send the browser to `url`. */
  | { type: "REDIRECT"; orderId: string; orderNumber: string; url: string }
  /** Razorpay Checkout.js modal. `subscriptionId` instead of `razorpayOrderId` for plans. */
  | {
      type: "RAZORPAY_MODAL";
      orderId: string;
      orderNumber: string;
      keyId: string;
      scriptUrl: string;
      razorpayOrderId: string | null;
      subscriptionId: string | null;
      amountMinor: number;
      currency: string;
      name: string;
      description: string;
      prefill: { name: string; email: string };
      /**
       * "native": open the real Razorpay SDK (mobile) or Checkout.js (web). "stub": the
       * server points at the local stubs; a native app opens `checkoutPageUrl` in a browser
       * tab instead, which redirects to `openlms://checkout/razorpay?razorpay_payment_id=...`
       * (or to its `redirect` query parameter) with the same signed fields the modal hands
       * its handler, ready for POST /api/checkout/razorpay/confirm.
       */
      mode: "native" | "stub";
      checkoutPageUrl: string | null;
    }
  /** A 100%-off coupon or a FREE course: fulfilled already, go to the receipt. */
  | { type: "FULFILLED"; orderId: string; orderNumber: string };

/** POST /api/checkout/razorpay/confirm: what Checkout.js hands the success callback. */
export interface RazorpayConfirm {
  orderId: string;
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature: string;
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export interface OrderLine {
  type: SellableType;
  id: string;
  title: string;
  slug: string | null;
  unit: Money;
  discount: Money;
  tax: Money;
  total: Money;
}

export interface Order {
  id: string;
  number: string;
  kind: OrderKind;
  status: OrderStatus;
  gateway: GatewayName;
  lines: OrderLine[];
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
  refunded: Money;
  couponCode: string | null;
  taxLabel: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
  invoice: { id: string; number: string; ready: boolean } | null;
  /** Where to send the learner once the order is paid (the first course, or My Learning). */
  continueTo: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  kind: "INVOICE" | "CREDIT_NOTE";
  orderNumber: string | null;
  total: Money;
  issuedAt: string;
  ready: boolean;
}
