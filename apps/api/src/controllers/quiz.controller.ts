/** /api/assessments quiz attempts. Thin: parse, call services/quiz.service.ts, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as quizzes from "../services/quiz.service";

/** One answer: option ids (SINGLE, TRUE_FALSE, MULTI) or text (SHORT_TEXT). Shape vs kind is checked against the snapshot. */
const answerValue = z.union([z.object({ optionIds: z.array(z.string().min(1).max(64)).max(50) }).strict(), z.object({ text: z.string().max(2000) }).strict()]);
const answers = z.record(z.string().min(1).max(64), answerValue).refine((o) => Object.keys(o).length <= 300, "too many answers");

const itemParam = z.object({ itemId: id() }).strict();
const attemptParam = z.object({ attemptId: id() }).strict();

export async function start(req: Request, res: Response) {
  const { itemId } = parse(itemParam, req.params);
  res.json(await quizzes.startAttempt(actorOf(req), itemId));
}

export async function get(req: Request, res: Response) {
  const { attemptId } = parse(attemptParam, req.params);
  res.json(await quizzes.getAttempt(actorOf(req), attemptId));
}

export async function save(req: Request, res: Response) {
  const { attemptId } = parse(attemptParam, req.params);
  const body = parse(z.object({ answers }).strict(), req.body);
  await quizzes.saveAnswers(actorOf(req), attemptId, body.answers);
  res.status(204).end();
}

export async function submit(req: Request, res: Response) {
  const { attemptId } = parse(attemptParam, req.params);
  const body = parse(z.object({ answers: answers.optional() }).strict(), req.body);
  res.json(await quizzes.submitAttempt(actorOf(req), attemptId, body.answers));
}
