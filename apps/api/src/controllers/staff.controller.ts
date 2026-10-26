/** /api/admin/staff: staff accounts and platform roles (ADMIN only). Thin: parse, call the service, respond. */
import { USER_ROLES } from "@open-lms/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { id, pageQuery, parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as staff from "../services/staff.service";

const listQuery = pageQuery.extend({ role: z.enum(["INSTRUCTOR", "SUPPORT", "FINANCE", "ADMIN"]).optional(), q: z.string().trim().max(120).optional() }).strict();

export async function list(req: Request, res: Response) {
  const q = parse(listQuery, req.query);
  res.json(await staff.listStaff(actorOf(req), { ...q, limit: q.limit ?? 20 }));
}

export async function changeRole(req: Request, res: Response) {
  const { userId } = parse(z.object({ userId: id() }), req.params);
  const { role } = parse(z.object({ role: z.enum(USER_ROLES) }).strict(), req.body);
  res.json(await staff.changeRole(actorOf(req), userId, role, meta(req)));
}
