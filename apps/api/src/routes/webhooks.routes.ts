/** /api/webhooks/stripe and /api/webhooks/razorpay: raw bodies, no auth, signature verified first, deduplicated by event id. */
import { Router } from "express";
import * as ctrl from "../controllers/billing-webhook.controller";

export const router = Router();

/** Stripe events. `Stripe-Signature: t=..,v1=..` over "t.raw", 5 minute tolerance. 200 (also for duplicates and rejected business rules), 400 bad signature. */
router.post("/stripe", ctrl.stripe);
/** Razorpay events. `X-Razorpay-Signature` hex HMAC over the raw body; deduplicated on `X-Razorpay-Event-Id`. 200, or 400 bad signature. */
router.post("/razorpay", ctrl.razorpay);
