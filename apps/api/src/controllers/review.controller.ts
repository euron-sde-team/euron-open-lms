/** /api/community reviews. Thin: parse, call services/review.service.ts, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, optionalText, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as reviews from "../services/review.service";

const courseParam = z.object({ courseId: id() }).strict();
const reviewParam = z.object({ reviewId: id() }).strict();

export async function eligibility(req: Request, res: Response) {
  const { courseId } = parse(courseParam, req.params);
  res.json(await reviews.eligibility(actorOf(req), courseId));
}

export async function upsert(req: Request, res: Response) {
  const { courseId } = parse(courseParam, req.params);
  const body = parse(z.object({ rating: z.number().int().min(1).max(5), body: optionalText(4000) }).strict(), req.body);
  res.json(await reviews.upsert(actorOf(req), courseId, { rating: body.rating, body: body.body }));
}

export async function remove(req: Request, res: Response) {
  const { courseId } = parse(courseParam, req.params);
  await reviews.remove(actorOf(req), courseId);
  res.status(204).end();
}

export async function reply(req: Request, res: Response) {
  const { reviewId } = parse(reviewParam, req.params);
  const body = parse(z.object({ body: text(2000, 1) }).strict(), req.body);
  res.json(await reviews.reply(actorOf(req), reviewId, body.body));
}
