/** /api/admin/evs (the video picker) and POST /api/webhooks/evs (raw body, signature-verified). */
import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as evs from "../services/evs.service";

const videosQuery = z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(1000).optional() }).strict();

export async function videos(req: Request, res: Response) {
  res.json(await evs.videos(actorOf(req), parse(videosQuery, req.query)));
}

export async function status(req: Request, res: Response) {
  res.json(evs.status(actorOf(req)));
}

export async function webhook(req: Request, res: Response) {
  res.json(await evs.handleWebhook(req.body as Buffer, req.get("evs-signature")));
}
