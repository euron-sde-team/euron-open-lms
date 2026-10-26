/** /api/assessments assignment submissions. Thin: parse, call services/submission.service.ts, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as submissions from "../services/submission.service";

const itemParam = z.object({ itemId: id() }).strict();

const submitBody = z
  .object({
    body: z.string().max(50_000).nullable().optional(),
    url: z.string().trim().max(500).nullable().optional(),
    uploadIds: z.array(id()).max(20).optional(),
  })
  .strict();

export async function submit(req: Request, res: Response) {
  const { itemId } = parse(itemParam, req.params);
  res.status(201).json(await submissions.submit(actorOf(req), itemId, parse(submitBody, req.body)));
}

export async function listOwn(req: Request, res: Response) {
  const { itemId } = parse(itemParam, req.params);
  res.json(await submissions.listOwn(actorOf(req), itemId));
}
