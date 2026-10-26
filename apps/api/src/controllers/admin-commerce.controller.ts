/** /api/admin/commerce: orders, refunds, subscriptions, plans, bundles, coupons, export. Thin: parse, call, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, pageQuery, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as admin from "../services/admin-commerce.service";
import { adminInvoiceDownloadUrl } from "../services/invoice.service";

const currency = z.string().regex(/^[A-Z]{3}$/, "must be an upper-case 3-letter currency code");
const slug = z.string().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lower-case letters, digits and dashes");
const amount = z.number().int().min(0).max(1_000_000_000_000);
const status = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);
const when = z.string().datetime({ offset: true });

const orderQuery = pageQuery.extend({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["PENDING", "PAID", "FAILED", "EXPIRED", "CANCELED", "PARTIALLY_REFUNDED", "REFUNDED"]).optional(),
  gateway: z.enum(["STRIPE", "RAZORPAY", "FREE"]).optional(),
}).strict();

const refundBody = z.object({ amountMinor: z.number().int().positive().max(1_000_000_000_000), reason: text(500, 3), revokeAccess: z.boolean() }).strict();
const subQuery = pageQuery.extend({ status: z.enum(["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"]).optional() }).strict();
const cancelBody = z.object({ atPeriodEnd: z.boolean().default(true) }).strict();

const planBody = z
  .object({
    slug,
    name: text(60, 2),
    description: text(2000).optional(),
    features: z.array(text(120, 1)).max(20).optional(),
    trialDays: z.number().int().min(0).max(90).optional(),
    status: status.optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
const planPrices = z.object({ prices: z.array(z.object({ currency, interval: z.enum(["MONTH", "YEAR"]), amountMinor: amount }).strict()).max(20) }).strict();

const bundleBody = z
  .object({
    slug,
    title: text(120, 3),
    description: text(5000).optional(),
    coverUploadId: id().nullable().optional(),
    status: status.optional(),
    courseIds: z.array(id()).max(100).optional(),
  })
  .strict();
const bundleQuery = pageQuery.extend({ q: z.string().trim().max(120).optional(), status: status.optional() }).strict();
const bundlePrices = z.object({ prices: z.array(z.object({ currency, amountMinor: amount, compareAtMinor: amount.nullable().optional() }).strict()).max(20) }).strict();

const target = z.object({ type: z.enum(["COURSE", "BUNDLE", "PLAN"]), id: id() }).strict();
const couponBody = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,40}$/, "3 to 40 letters, digits, - or _"),
    description: text(200).nullable().optional(),
    kind: z.enum(["PERCENT", "FIXED"]),
    percentOff: z.number().int().min(1).max(100).nullable().optional(),
    amountOffMinor: z.number().int().positive().max(1_000_000_000_000).nullable().optional(),
    currency: currency.nullable().optional(),
    scope: z.enum(["ALL", "COURSES", "BUNDLES", "PLANS", "SPECIFIC"]),
    targets: z.array(target).max(100).optional(),
    maxRedemptions: z.number().int().min(1).max(10_000_000).nullable().optional(),
    perUserLimit: z.number().int().min(1).max(1000).optional(),
    startsAt: when.nullable().optional(),
    expiresAt: when.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
const couponPatch = couponBody.pick({ description: true, targets: true, maxRedemptions: true, perUserLimit: true, startsAt: true, expiresAt: true, active: true }).strict();
const couponQuery = pageQuery.extend({ q: z.string().trim().max(40).optional() }).strict();
const exportQuery = z.object({ from: z.string().max(40).optional(), to: z.string().max(40).optional() }).strict();

const ip = (req: Request) => meta(req).ip;

export async function orders(req: Request, res: Response) {
  res.json(await admin.searchOrders(actorOf(req), parse(orderQuery, req.query)));
}

export async function order(req: Request, res: Response) {
  res.json(await admin.orderDetail(actorOf(req), parse(idParam, req.params).id));
}

export async function refund(req: Request, res: Response) {
  res.json(await admin.refundOrder(actorOf(req), parse(idParam, req.params).id, parse(refundBody, req.body), ip(req)));
}

export async function subscriptions(req: Request, res: Response) {
  res.json(await admin.listSubscriptions(actorOf(req), parse(subQuery, req.query)));
}

export async function cancelSubscription(req: Request, res: Response) {
  res.json(await admin.cancelSubscriptionAdmin(actorOf(req), parse(idParam, req.params).id, parse(cancelBody, req.body).atPeriodEnd, ip(req)));
}

export async function plans(req: Request, res: Response) {
  res.json(await admin.listPlansAdmin(actorOf(req)));
}

export async function createPlan(req: Request, res: Response) {
  res.status(201).json(await admin.createPlan(actorOf(req), parse(planBody, req.body), ip(req)));
}

export async function updatePlan(req: Request, res: Response) {
  res.json(await admin.updatePlan(actorOf(req), parse(idParam, req.params).id, parse(planBody.partial().strict(), req.body), ip(req)));
}

export async function putPlanPrices(req: Request, res: Response) {
  res.json(await admin.putPlanPrices(actorOf(req), parse(idParam, req.params).id, parse(planPrices, req.body).prices, ip(req)));
}

export async function bundles(req: Request, res: Response) {
  res.json(await admin.listBundlesAdmin(actorOf(req), parse(bundleQuery, req.query)));
}

export async function bundle(req: Request, res: Response) {
  res.json(await admin.getBundleAdmin(actorOf(req), parse(idParam, req.params).id));
}

export async function createBundle(req: Request, res: Response) {
  res.status(201).json(await admin.createBundle(actorOf(req), parse(bundleBody, req.body), ip(req)));
}

export async function updateBundle(req: Request, res: Response) {
  res.json(await admin.updateBundle(actorOf(req), parse(idParam, req.params).id, parse(bundleBody.partial().strict(), req.body), ip(req)));
}

export async function putBundlePrices(req: Request, res: Response) {
  res.json(await admin.putBundlePrices(actorOf(req), parse(idParam, req.params).id, parse(bundlePrices, req.body).prices, ip(req)));
}

export async function coupons(req: Request, res: Response) {
  res.json(await admin.listCoupons(actorOf(req), parse(couponQuery, req.query)));
}

export async function createCoupon(req: Request, res: Response) {
  res.status(201).json(await admin.createCoupon(actorOf(req), parse(couponBody, req.body), ip(req)));
}

export async function updateCoupon(req: Request, res: Response) {
  res.json(await admin.updateCoupon(actorOf(req), parse(idParam, req.params).id, parse(couponPatch, req.body), ip(req)));
}

/** Streams the CSV; validation and authorization happen before the first byte. */
export async function exportOrders(req: Request, res: Response) {
  const q = parse(exportQuery, req.query);
  const rows = admin.exportOrders(actorOf(req), q);
  const first = await rows.next();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "private, no-store");
  if (!first.done) res.write(first.value);
  for await (const chunk of rows) {
    if (!res.write(chunk)) await new Promise((r) => res.once("drain", r));
  }
  res.end();
}

export async function invoicePdf(req: Request, res: Response) {
  const url = await adminInvoiceDownloadUrl(actorOf(req), parse(idParam, req.params).id);
  res.setHeader("Cache-Control", "private, no-store");
  res.redirect(302, url);
}
