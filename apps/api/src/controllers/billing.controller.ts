/** /api/billing: the learner's orders, invoices and subscription. Thin: parse, call, respond. */
import type { Request, Response } from "express";
import { idParam, pageQuery, parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as billing from "../services/billing.service";

export async function orders(req: Request, res: Response) {
  res.json(await billing.myOrders(actorOf(req), parse(pageQuery.strict(), req.query)));
}

export async function invoices(req: Request, res: Response) {
  res.json(await billing.myInvoices(actorOf(req), parse(pageQuery.strict(), req.query)));
}

export async function invoicePdf(req: Request, res: Response) {
  const url = await billing.invoicePdfUrl(actorOf(req), parse(idParam, req.params).id);
  res.setHeader("Cache-Control", "private, no-store");
  res.redirect(302, url);
}

export async function subscription(req: Request, res: Response) {
  res.json(await billing.mySubscription(actorOf(req)));
}

export async function cancelSubscription(req: Request, res: Response) {
  res.json(await billing.cancelMySubscription(actorOf(req), meta(req).ip));
}

export async function resumeSubscription(req: Request, res: Response) {
  res.json(await billing.resumeMySubscription(actorOf(req), meta(req).ip));
}
