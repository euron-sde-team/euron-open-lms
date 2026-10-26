/**
 * Commerce endpoints: checkout (checkout.routes.ts), the learner's billing
 * (billing.routes.ts) and the admin commerce console (admin-commerce.routes.ts). See
 * docs/api/rest-contract.md "Checkout", "Billing" and "Admin: commerce".
 *
 * A client never sends an amount: quotes and orders are priced on the server.
 */
import type {
  AdminBundle, AdminCoupon, AdminOrderDetail, AdminOrderRow, AdminPlan, AdminPrice, AdminSubscriptionRow, BillingInterval,
  CheckoutHandoff, CheckoutQuote, CheckoutQuoteRequest, CheckoutStartRequest, CouponKind, CouponScope, GatewayName, Invoice,
  Order, OrderStatus, Page, Plan, RazorpayConfirm, SellableType, SubscriptionStatus, SubscriptionSummary,
} from "@open-lms/types";
import { enc, type Helpers, type PageQuery } from "./helpers";

export interface AdminOrdersQuery extends PageQuery {
  /** An order number (ORD-...), or part of the buyer's email or name. */
  q?: string;
  status?: OrderStatus;
  gateway?: GatewayName;
}

export interface RefundInput {
  amountMinor: number;
  reason: string;
  /** Revoke the enrollments this order granted (the learner then sees "refunded"). */
  revokeAccess: boolean;
}

export interface PlanInput {
  slug: string;
  name: string;
  description?: string;
  features?: string[];
  trialDays?: number;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  position?: number;
}

export interface BundleInput {
  slug: string;
  title: string;
  description?: string;
  coverUploadId?: string | null;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
  /** In display order; replaces the list. */
  courseIds?: string[];
}

export interface CouponInput {
  code: string;
  description?: string | null;
  kind: CouponKind;
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

export function commerceEndpoints(h: Helpers) {
  const { get, pub, post, put, patch, pq, download } = h;

  const checkout = {
    plans: (currency?: string) => pub<Plan[]>("/checkout/plans", pq({ currency })),
    quote: (body: CheckoutQuoteRequest) => post<CheckoutQuote>("/checkout/quote", body),
    /** One idempotency key per click: a retry returns the same order and handoff. */
    start: (body: CheckoutStartRequest) => post<CheckoutHandoff>("/checkout/start", body),
    /** Forward Checkout.js's success payload; the server verifies it and fulfils. */
    razorpayConfirm: (body: RazorpayConfirm) => post<Order>("/checkout/razorpay/confirm", body),
    /** `sync` asks Stripe once about a PENDING order (the return page). */
    order: (orderId: string, opts: { sync?: boolean } = {}) => get<Order>(`/checkout/orders/${enc(orderId)}`, pq(opts.sync ? { sync: "1" } : undefined)),
    cancelOrder: (orderId: string) => post<Order>(`/checkout/orders/${enc(orderId)}/cancel`),
  };

  const billing = {
    orders: (q?: PageQuery) => get<Page<Order>>("/billing/orders", pq(q)),
    invoices: (q?: PageQuery) => get<Page<Invoice>>("/billing/invoices", pq(q)),
    /** The PDF (the API answers with a short-lived signed URL, followed here). 409 INVOICE_RENDERING. */
    invoicePdf: (invoiceId: string) => download(`/billing/invoices/${enc(invoiceId)}/pdf`),
    subscription: () => get<SubscriptionSummary | null>("/billing/subscription"),
    cancelSubscription: () => post<SubscriptionSummary>("/billing/subscription/cancel"),
    resumeSubscription: () => post<SubscriptionSummary>("/billing/subscription/resume"),
  };

  const adminCommerce = {
    /** Any invoice or credit note PDF (area orders). 409 INVOICE_RENDERING while it renders. */
    invoicePdf: (invoiceId: string) => download(`/admin/commerce/invoices/${enc(invoiceId)}/pdf`),
    orders: (q?: AdminOrdersQuery) => get<Page<AdminOrderRow>>("/admin/commerce/orders", pq(q)),
    order: (id: string) => get<AdminOrderDetail>(`/admin/commerce/orders/${enc(id)}`),
    refund: (id: string, body: RefundInput) => post<AdminOrderDetail>(`/admin/commerce/orders/${enc(id)}/refunds`, body),
    subscriptions: (q?: PageQuery & { status?: SubscriptionStatus }) => get<Page<AdminSubscriptionRow>>("/admin/commerce/subscriptions", pq(q)),
    cancelSubscription: (id: string, atPeriodEnd = true) => post<AdminSubscriptionRow>(`/admin/commerce/subscriptions/${enc(id)}/cancel`, { atPeriodEnd }),
    plans: () => get<AdminPlan[]>("/admin/commerce/plans"),
    createPlan: (body: PlanInput) => post<AdminPlan>("/admin/commerce/plans", body),
    updatePlan: (id: string, body: Partial<PlanInput>) => patch<AdminPlan>(`/admin/commerce/plans/${enc(id)}`, body),
    setPlanPrices: (id: string, prices: { currency: string; interval: BillingInterval; amountMinor: number }[]) => put<AdminPrice[]>(`/admin/commerce/plans/${enc(id)}/prices`, { prices }),
    bundles: (q?: PageQuery & { q?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED" }) => get<Page<AdminBundle>>("/admin/commerce/bundles", pq(q)),
    bundle: (id: string) => get<AdminBundle>(`/admin/commerce/bundles/${enc(id)}`),
    createBundle: (body: BundleInput) => post<AdminBundle>("/admin/commerce/bundles", body),
    updateBundle: (id: string, body: Partial<BundleInput>) => patch<AdminBundle>(`/admin/commerce/bundles/${enc(id)}`, body),
    setBundlePrices: (id: string, prices: { currency: string; amountMinor: number; compareAtMinor?: number | null }[]) => put<AdminPrice[]>(`/admin/commerce/bundles/${enc(id)}/prices`, { prices }),
    coupons: (q?: PageQuery & { q?: string }) => get<Page<AdminCoupon>>("/admin/commerce/coupons", pq(q)),
    createCoupon: (body: CouponInput) => post<AdminCoupon>("/admin/commerce/coupons", body),
    updateCoupon: (id: string, body: CouponPatch) => patch<AdminCoupon>(`/admin/commerce/coupons/${enc(id)}`, body),
    /** Orders created in [from, to) (ISO; default the last 30 days) as CSV. */
    exportOrdersCsv: (range: { from?: string; to?: string } = {}) => download("/admin/commerce/export/orders.csv", pq(range)),
  };

  return { checkout, billing, adminCommerce };
}
