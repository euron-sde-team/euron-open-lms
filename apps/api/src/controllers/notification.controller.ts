/** /api/notifications: the inbox, the unread badge, marking read. */
import type { Request, Response } from "express";
import { z } from "zod";
import { idParam, pageQuery, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as notifications from "../services/notification.service";

export async function list(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ unread: z.enum(["true", "false"]).optional() }), req.query);
  res.json(await notifications.listNotifications(actorOf(req), { unreadOnly: q.unread === "true", cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function counts(req: Request, res: Response) {
  res.json(await notifications.countsFor(actorOf(req).id));
}

export async function markRead(req: Request, res: Response) {
  await notifications.markRead(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function markAllRead(req: Request, res: Response) {
  await notifications.markAllRead(actorOf(req));
  res.status(204).end();
}
