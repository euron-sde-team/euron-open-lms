/** /api/checkout: plans, quotes, starting payments, the Razorpay return and the learner's order. Thin: parse, call, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as checkout from "../services/checkout.service";

const currency = z.string().regex(/^[A-Za-z]{3}$/, "must be a 3-letter currency code").transform((v) => v.toUpperCase());

export const billingDetails = z
  .object({
    name: text(120, 1),
    country: z.string().regex(/^[A-Za-z]{2}$/, "must be a 2-letter country code"),
    region: text(80).optional(),
    taxId: text(40).optional(),
    addressLine: text(200).optional(),
    postalCode: text(20).optional(),
  })
  .strict();

const quoteBody = z
  .object({
    item: z.object({ type: z.enum(["COURSE", "BUNDLE", "PLAN"]), id: id(), interval: z.enum(["MONTH", "YEAR"]).optional() }).strict(),
    currency,
    couponCode: z.string().trim().max(40).optional(),
    billing: billingDetails.optional(),
  })
  .strict();

const startBody = quoteBody.extend({ idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, "must be 8 to 100 letters, digits, - or _") }).strict();

const confirmBody = z
  .object({
    orderId: id(),
    razorpay_payment_id: z.string().regex(/^[\w-]{1,100}$/),
    razorpay_order_id: z.string().regex(/^[\w-]{1,100}$/).optional(),
    razorpay_subscription_id: z.string().regex(/^[\w-]{1,100}$/).optional(),
    razorpay_signature: z.string().regex(/^[a-fA-F0-9]{16,200}$/),
  })
  .strict();

export async function plans(req: Request, res: Response) {
  const q = parse(z.object({ currency: currency.optional() }).strict(), req.query);
  res.json(await checkout.listPlans(req.actor, q.currency));
}

export async function quote(req: Request, res: Response) {
  res.json(await checkout.quote(actorOf(req), parse(quoteBody, req.body)));
}

export async function start(req: Request, res: Response) {
  res.status(201).json(await checkout.start(actorOf(req), parse(startBody, req.body)));
}

export async function razorpayConfirm(req: Request, res: Response) {
  res.json(await checkout.razorpayConfirm(actorOf(req), parse(confirmBody, req.body)));
}

export async function getOrder(req: Request, res: Response) {
  const { id: orderId } = parse(idParam, req.params);
  const q = parse(z.object({ sync: z.enum(["0", "1", "true", "false"]).optional() }).strict(), req.query);
  res.json(await checkout.getOrder(actorOf(req), orderId, q.sync === "1" || q.sync === "true"));
}

export async function cancelOrder(req: Request, res: Response) {
  res.json(await checkout.cancelOrder(actorOf(req), parse(idParam, req.params).id));
}
