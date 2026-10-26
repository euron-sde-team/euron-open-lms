/** /api/admin/courses/:id/questions: the course's question bank. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, pageQuery, parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as questions from "../services/question.service";

const courseParam = z.object({ id: id() });
const questionParams = z.object({ id: id(), questionId: id() });

const listQuery = pageQuery.extend({ q: z.string().trim().max(100).optional(), tag: z.string().trim().max(40).optional() }).strict();

const fields = {
  kind: z.enum(["SINGLE", "MULTI", "TRUE_FALSE", "SHORT_TEXT"]),
  prompt: z.string().trim().min(1).max(5000),
  explanation: z.string().trim().max(5000).nullable().transform((v) => (v ? v : null)),
  points: z.number().int().min(1).max(100),
  options: z.array(z.object({ id: z.string().max(8).optional(), text: z.string().max(500), correct: z.boolean() }).strict()).max(8),
  acceptedAnswers: z.array(z.string().max(200)).max(10),
  matchMode: z.enum(["EXACT", "CASE_INSENSITIVE", "REGEX"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
};

const createBody = z
  .object(fields)
  .partial({ explanation: true, points: true, options: true, acceptedAnswers: true, matchMode: true, tags: true })
  .strict();
const patchBody = z.object(fields).partial().strict();

export async function list(req: Request, res: Response) {
  const { id: courseId } = parse(courseParam, req.params);
  res.json(await questions.listQuestions(actorOf(req), courseId, parse(listQuery, req.query)));
}

export async function create(req: Request, res: Response) {
  const { id: courseId } = parse(courseParam, req.params);
  res.status(201).json(await questions.createQuestion(actorOf(req), courseId, parse(createBody, req.body), meta(req)));
}

export async function update(req: Request, res: Response) {
  const p = parse(questionParams, req.params);
  res.json(await questions.updateQuestion(actorOf(req), p.id, p.questionId, parse(patchBody, req.body), meta(req)));
}

/** 204 when the question was deleted; 200 with the archived question when a quiz still uses it. */
export async function remove(req: Request, res: Response) {
  const p = parse(questionParams, req.params);
  const archived = await questions.deleteQuestion(actorOf(req), p.id, p.questionId, meta(req));
  if (archived) res.json(archived);
  else res.status(204).end();
}
