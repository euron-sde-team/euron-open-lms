/** /api/checkout: plans on sale, quotes, starting a payment, the Razorpay return and order status. */
import { Router } from "express";
import * as ctrl from "../controllers/checkout.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Plans on sale with their prices in `?currency=` (else your preferred currency, else the default). Returns `Plan[]`. */
router.get("/plans", optionalAuth, ctrl.plans);
/**
 * Price an item: `CheckoutQuoteRequest` `{ item: { type, id, interval? }, currency, couponCode?, billing? }`. Returns
 * `CheckoutQuote` (a coupon that does not apply comes back as `couponError`). 400 CURRENCY_NOT_SUPPORTED, INTERVAL_REQUIRED;
 * 404 for unknown or unpublished items; 409 NOT_FOR_SALE, PRICE_NOT_AVAILABLE, BUNDLE_EMPTY, CURRENCY_NOT_PAYABLE.
 */
router.post("/quote", authenticate, rateLimit("checkout-quote", 60, 60), ctrl.quote);
/**
 * Start paying: `CheckoutStartRequest` (the quote body plus `idempotencyKey`, one per click). Returns `CheckoutHandoff`
 * (REDIRECT to Stripe, RAZORPAY_MODAL options, or FULFILLED for a zero total). A retry with the same key returns the same
 * order. 409 ALREADY_OWNED, SUBSCRIPTION_EXISTS, COUPON_INVALID (details.reason), CHECKOUT_IN_PROGRESS; 502 GATEWAY_ERROR.
 */
router.post("/start", authenticate, rateLimit("checkout-start", 20, 600), ctrl.start);
/**
 * Razorpay Checkout.js success payload: `RazorpayConfirm`. The signature is verified (constant time), then the payment is
 * fetched from Razorpay and its captured amount checked against the order. Returns `Order`. 400 PAYMENT_NOT_VERIFIED.
 */
router.post("/razorpay/confirm", authenticate, rateLimit("checkout-confirm", 30, 600), ctrl.razorpayConfirm);
/** Your order (`Order`). `?sync=1` asks Stripe once about a PENDING order so the return page settles. Others' orders are 404. */
router.get("/orders/:id", authenticate, rateLimit("checkout-order", 120, 60), ctrl.getOrder);
/** Cancel your unpaid order. Returns `Order`. 409 ORDER_NOT_PENDING. */
router.post("/orders/:id/cancel", authenticate, ctrl.cancelOrder);
