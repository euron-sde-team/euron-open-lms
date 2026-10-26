/** /api/admin/commerce: orders and refunds, subscriptions, plans, bundles, coupons and the orders CSV. */
import { Router } from "express";
import * as ctrl from "../controllers/admin-commerce.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

router.use(authenticate);

/** Search orders by number, buyer email or name; `?status=&gateway=&cursor=`. Area orders. Returns `Page<AdminOrderRow>`. */
router.get("/orders", ctrl.orders);
/** One order with its event timeline, refunds, enrollments, invoices and what is left to refund. Returns `AdminOrderDetail`. */
router.get("/orders/:id", ctrl.order);
/**
 * Refund `{ amountMinor, reason, revokeAccess }` (ADMIN, FINANCE). Returns `AdminOrderDetail`. 403 FORBIDDEN_ROLE for
 * SUPPORT; 409 REFUND_EXCEEDS, NOT_REFUNDABLE; 502 GATEWAY_ERROR.
 */
router.post("/orders/:id/refunds", rateLimit("admin-refund", 30, 600), ctrl.refund);
/** Any invoice or credit note PDF: 302 to a short-lived signed URL. Area orders. 409 INVOICE_RENDERING while it renders. */
router.get("/invoices/:id/pdf", ctrl.invoicePdf);
/** Subscriptions, `?status=&cursor=`. Returns `Page<AdminSubscriptionRow>`. */
router.get("/subscriptions", ctrl.subscriptions);
/** Cancel `{ atPeriodEnd }` (ADMIN, FINANCE; default at period end). Returns `AdminSubscriptionRow`. 409 SUBSCRIPTION_NOT_ACTIVE. */
router.post("/subscriptions/:id/cancel", ctrl.cancelSubscription);
/** Every plan. Area plans. Returns `AdminPlan[]`. */
router.get("/plans", ctrl.plans);
/** Create a plan `{ slug, name, description?, features?, trialDays?, status?, position? }`. Returns `AdminPlan`. 409 SLUG_TAKEN. */
router.post("/plans", ctrl.createPlan);
/** Edit a plan (the same fields, all optional). Returns `AdminPlan`. */
router.patch("/plans/:id", ctrl.updatePlan);
/** Replace a plan's prices `{ prices: { currency, interval, amountMinor }[] }`. Returns `AdminPrice[]`. 400 CURRENCY_NOT_ENABLED, DUPLICATE_PRICE. */
router.put("/plans/:id/prices", ctrl.putPlanPrices);
/** Bundles, `?q=&status=&cursor=`. Returns `Page<AdminBundle>`. */
router.get("/bundles", ctrl.bundles);
/** Create a bundle `{ slug, title, description?, coverUploadId?, status?, courseIds? }`. Returns `AdminBundle`. 400 UNKNOWN_COURSE; 409 BUNDLE_EMPTY, SLUG_TAKEN. */
router.post("/bundles", ctrl.createBundle);
/** One bundle. Returns `AdminBundle`. */
router.get("/bundles/:id", ctrl.bundle);
/** Edit a bundle (the same fields; `courseIds` replaces the list in order). Returns `AdminBundle`. */
router.patch("/bundles/:id", ctrl.updateBundle);
/** Replace a bundle's prices `{ prices: { currency, amountMinor, compareAtMinor? }[] }`. Returns `AdminPrice[]`. */
router.put("/bundles/:id/prices", ctrl.putBundlePrices);
/** Coupons, `?q=&cursor=`. Area coupons. Returns `Page<AdminCoupon>`. */
router.get("/coupons", ctrl.coupons);
/** Create a coupon (kind PERCENT with percentOff, or FIXED with amountOffMinor and currency; SPECIFIC scope with targets). Returns `AdminCoupon`. 409 COUPON_CODE_TAKEN. */
router.post("/coupons", ctrl.createCoupon);
/** Edit a coupon's description, targets, limits, window or active flag. Returns `AdminCoupon`. 409 BELOW_REDEMPTIONS. */
router.patch("/coupons/:id", ctrl.updateCoupon);
/** Orders created in `?from=&to=` (ISO, default the last 30 days, at most 400) as CSV, streamed. */
router.get("/export/orders.csv", rateLimit("admin-export", 10, 600), ctrl.exportOrders);
