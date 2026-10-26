/** Gateway webhooks. The body is the raw Buffer (app.ts mounts these routes before the JSON parser). */
import type { Request, Response } from "express";
import { handleWebhook } from "../services/payments/webhook.service";

async function respond(gateway: "STRIPE" | "RAZORPAY", req: Request, res: Response) {
  const r = await handleWebhook(gateway, req.body, req.headers);
  res.status(r.status).json(r.body);
}

export const stripe = (req: Request, res: Response) => respond("STRIPE", req, res);
export const razorpay = (req: Request, res: Response) => respond("RAZORPAY", req, res);
