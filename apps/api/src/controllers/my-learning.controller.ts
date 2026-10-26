/** /api/my: My Learning, the dashboard summary, the wishlist, bookmarks and certificates. Thin: parse, call the service, respond. */
import type { Request, Response } from "express";
import { z } from "zod";
import { pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as certificates from "../services/certificate.service";
import * as my from "../services/my-learning.service";

export async function learning(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ status: z.enum(["in_progress", "completed", "all"]).optional() }).strict(), req.query);
  res.json(await my.learning(actorOf(req), q));
}

export async function summary(req: Request, res: Response) {
  parse(z.object({}).strict(), req.query);
  res.json(await my.summary(actorOf(req)));
}

export async function saved(req: Request, res: Response) {
  res.json(await my.saved(actorOf(req), parse(pageQuery.strict(), req.query)));
}

export async function bookmarks(req: Request, res: Response) {
  res.json(await my.bookmarks(actorOf(req), parse(pageQuery.strict(), req.query)));
}

export async function certificatesList(req: Request, res: Response) {
  parse(z.object({}).strict(), req.query);
  res.json(await certificates.mine(actorOf(req)));
}
