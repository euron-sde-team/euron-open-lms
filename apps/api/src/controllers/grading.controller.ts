/** /api/admin/grading. Thin: parse, call services/grading.service.ts, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, pageQuery, parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as grading from "../services/grading.service";

const submissionParam = z.object({ submissionId: id() }).strict();

const listQuery = pageQuery
  .extend({
    status: z.enum(["SUBMITTED", "CHANGES_REQUESTED", "APPROVED", "REJECTED"]).optional(),
    courseId: id().optional(),
  })
  .strict();

const reviewBody = z
  .object({
    decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
    scores: z.record(z.string().min(1).max(64), z.number().finite()).refine((o) => Object.keys(o).length <= 50, "too many scores"),
    feedback: z.string().trim().max(20_000).nullable().optional(),
  })
  .strict();

export async function list(req: Request, res: Response) {
  const q = parse(listQuery, req.query);
  res.json(await grading.listQueue(actorOf(req), { status: q.status ?? "SUBMITTED", courseId: q.courseId, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function detail(req: Request, res: Response) {
  const { submissionId } = parse(submissionParam, req.params);
  res.json(await grading.getDetail(actorOf(req), submissionId));
}

export async function review(req: Request, res: Response) {
  const { submissionId } = parse(submissionParam, req.params);
  const body = parse(reviewBody, req.body);
  res.json(await grading.review(actorOf(req), submissionId, { decision: body.decision, scores: body.scores, feedback: body.feedback || null }, meta(req)));
}

export async function suggest(req: Request, res: Response) {
  const { submissionId } = parse(submissionParam, req.params);
  parse(z.object({}).strict(), req.body);
  res.json(await grading.suggest(actorOf(req), submissionId));
}
