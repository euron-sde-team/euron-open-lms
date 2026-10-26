/** /api/billing: your orders, invoices and subscription. */
import { Router } from "express";
import * as ctrl from "../controllers/billing.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Your orders, newest first. Returns `Page<Order>`. */
router.get("/orders", authenticate, ctrl.orders);
/** Your invoices and credit notes, newest first. Returns `Page<Invoice>`. */
router.get("/invoices", authenticate, ctrl.invoices);
/** Download one of your invoices: 302 to a short-lived signed URL. 409 INVOICE_RENDERING; others' invoices are 404. */
router.get("/invoices/:id/pdf", authenticate, ctrl.invoicePdf);
/** Your subscription: `SubscriptionSummary | null`. */
router.get("/subscription", authenticate, ctrl.subscription);
/** Cancel at the end of the paid period. Returns `SubscriptionSummary`. 409 SUBSCRIPTION_NOT_ACTIVE. */
router.post("/subscription/cancel", authenticate, rateLimit("billing-cancel", 10, 3600), ctrl.cancelSubscription);
/** Undo a pending cancel. Returns `SubscriptionSummary`. 409 NOTHING_TO_RESUME, RESUME_NOT_SUPPORTED (Razorpay). */
router.post("/subscription/resume", authenticate, rateLimit("billing-resume", 10, 3600), ctrl.resumeSubscription);
