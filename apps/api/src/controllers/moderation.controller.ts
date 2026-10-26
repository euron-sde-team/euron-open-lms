/** /api/admin/moderation. Thin: parse, call services/moderation.service.ts, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { idParam, optionalText, pageQuery, parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as moderation from "../services/moderation.service";

export async function list(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ status: z.enum(["OPEN", "RESOLVED"]).optional() }).strict(), req.query);
  res.json(await moderation.listReports(actorOf(req), { status: q.status ?? "OPEN", cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function resolve(req: Request, res: Response) {
  const { id } = parse(idParam, req.params);
  const body = parse(z.object({ action: z.enum(["HIDE", "RESTORE", "DISMISS"]), note: optionalText(500) }).strict(), req.body);
  res.json(await moderation.resolve(actorOf(req), id, body, meta(req)));
}
