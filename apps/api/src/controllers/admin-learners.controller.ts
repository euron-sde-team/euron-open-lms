/** /api/admin/learners and /api/admin/enrollments: the learners console. Thin: parse, call the service, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, optionalText, pageQuery, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as learners from "../services/admin-learners.service";

const listQuery = pageQuery.extend({ q: z.string().trim().max(120).optional(), status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "BANNED", "DEACTIVATED"]).optional() }).strict();
const isoDate = z.string().datetime({ offset: true });
const reasonBody = z.object({ reason: text(300, 3) }).strict();
const empty = z.object({}).strict();

export async function list(req: Request, res: Response) {
  const q = parse(listQuery, req.query);
  res.json(await learners.listLearners(actorOf(req), { ...q, limit: q.limit ?? 20 }));
}

export async function detail(req: Request, res: Response) {
  res.json(await learners.learnerDetail(actorOf(req), parse(idParam, req.params).id));
}

export async function grant(req: Request, res: Response) {
  const body = parse(z.object({ courseId: id(), validUntil: isoDate.nullable().optional(), note: optionalText(300) }).strict(), req.body);
  res.status(201).json(await learners.grantAccess(actorOf(req), parse(idParam, req.params).id, body));
}

export async function revoke(req: Request, res: Response) {
  const { reason } = parse(reasonBody, req.body);
  res.json(await learners.revokeAccess(actorOf(req), parse(idParam, req.params).id, reason));
}

export async function patchEnrollment(req: Request, res: Response) {
  const { validUntil } = parse(z.object({ validUntil: isoDate.nullable() }).strict(), req.body);
  res.json(await learners.setValidUntil(actorOf(req), parse(idParam, req.params).id, validUntil, meta(req)));
}

export async function suspend(req: Request, res: Response) {
  const body = parse(z.object({ days: z.number().int().min(1).max(365), reason: text(300, 3) }).strict(), req.body);
  res.json(await learners.suspend(actorOf(req), parse(idParam, req.params).id, body, meta(req)));
}

export async function unsuspend(req: Request, res: Response) {
  parse(empty, req.body);
  res.json(await learners.unsuspend(actorOf(req), parse(idParam, req.params).id, meta(req)));
}

export async function ban(req: Request, res: Response) {
  const { reason } = parse(reasonBody, req.body);
  res.json(await learners.ban(actorOf(req), parse(idParam, req.params).id, reason, meta(req)));
}

export async function unban(req: Request, res: Response) {
  parse(empty, req.body);
  res.json(await learners.unban(actorOf(req), parse(idParam, req.params).id, meta(req)));
}

export async function erase(req: Request, res: Response) {
  const { reason } = parse(reasonBody, req.body);
  await learners.erase(actorOf(req), parse(idParam, req.params).id, reason, meta(req));
  res.status(204).end();
}
