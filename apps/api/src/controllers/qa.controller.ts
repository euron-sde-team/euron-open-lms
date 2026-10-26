/** /api/community Q&A. Thin: parse, call services/qa.service.ts, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, pageQuery, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as qa from "../services/qa.service";

const courseParam = z.object({ courseId: id() }).strict();
const threadParam = z.object({ threadId: id() }).strict();
const replyParam = z.object({ replyId: id() }).strict();

const listQuery = pageQuery
  .extend({
    itemId: id().optional(),
    q: z.string().trim().max(100).optional(),
    sort: z.enum(["recent", "unanswered"]).optional(),
  })
  .strict();

export async function list(req: Request, res: Response) {
  const { courseId } = parse(courseParam, req.params);
  const q = parse(listQuery, req.query);
  res.json(await qa.listThreads(actorOf(req), courseId, { itemId: q.itemId, q: q.q, sort: q.sort ?? "recent", cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function create(req: Request, res: Response) {
  const { courseId } = parse(courseParam, req.params);
  const body = parse(z.object({ title: text(160, 3), body: text(10_000, 1), itemId: id().nullable().optional() }).strict(), req.body);
  res.status(201).json(await qa.createThread(actorOf(req), courseId, body));
}

export async function get(req: Request, res: Response) {
  const { threadId } = parse(threadParam, req.params);
  res.json(await qa.getThread(actorOf(req), threadId));
}

export async function reply(req: Request, res: Response) {
  const { threadId } = parse(threadParam, req.params);
  const body = parse(z.object({ body: text(10_000, 1) }).strict(), req.body);
  res.status(201).json(await qa.reply(actorOf(req), threadId, body.body));
}

export async function accept(req: Request, res: Response) {
  const { threadId } = parse(threadParam, req.params);
  const body = parse(z.object({ replyId: id().nullable() }).strict(), req.body);
  res.json(await qa.accept(actorOf(req), threadId, body.replyId));
}

export async function editThread(req: Request, res: Response) {
  const { threadId } = parse(threadParam, req.params);
  const body = parse(
    z
      .object({ title: text(160, 3), body: text(10_000, 1) })
      .partial()
      .strict()
      .refine((b) => b.title !== undefined || b.body !== undefined, "nothing to change"),
    req.body,
  );
  res.json(await qa.editThread(actorOf(req), threadId, body));
}

export async function deleteThread(req: Request, res: Response) {
  const { threadId } = parse(threadParam, req.params);
  await qa.deleteThread(actorOf(req), threadId);
  res.status(204).end();
}

export async function editReply(req: Request, res: Response) {
  const { replyId } = parse(replyParam, req.params);
  const body = parse(z.object({ body: text(10_000, 1) }).strict(), req.body);
  res.json(await qa.editReply(actorOf(req), replyId, body.body));
}

export async function deleteReply(req: Request, res: Response) {
  const { replyId } = parse(replyParam, req.params);
  await qa.deleteReply(actorOf(req), replyId);
  res.status(204).end();
}
