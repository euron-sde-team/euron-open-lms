/** /api/users: your account, sessions, export and deletion. Thin: parse, call the service, respond. */
import { EMAIL_CATEGORIES } from "@open-lms/types";
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, parse, text } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as account from "../services/account.service";
import * as users from "../services/user.service";

const accountPatch = z
  .object({
    displayName: text(80, 1),
    certificateName: text(120, 1).nullable(),
    headline: z.string().trim().max(120).nullable(),
    bio: z.string().trim().max(2000).nullable(),
    website: z.string().trim().max(300).nullable(),
    avatarUploadId: id().nullable(),
    preferredCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    emailPreferences: z.object(Object.fromEntries(EMAIL_CATEGORIES.map((c) => [c, z.boolean()])) as Record<(typeof EMAIL_CATEGORIES)[number], z.ZodBoolean>).partial().strict(),
  })
  .partial()
  .strict();

export async function me(req: Request, res: Response) {
  res.json(await users.me(actorOf(req)));
}

export async function updateMe(req: Request, res: Response) {
  res.json(await users.updateMe(actorOf(req), parse(accountPatch, req.body)));
}

export async function deleteMe(req: Request, res: Response) {
  const body = parse(z.object({ password: z.string().min(1).max(200), totp: z.string().max(10).optional(), recoveryCode: z.string().max(40).optional() }).strict(), req.body);
  res.json(await account.requestDeletion(actorOf(req), body, meta(req)));
}

export async function exportMe(req: Request, res: Response) {
  await account.exportAccount(actorOf(req), res);
}

export async function mySessions(req: Request, res: Response) {
  res.json(await users.sessions(actorOf(req), meta(req)));
}

export async function revokeSession(req: Request, res: Response) {
  await users.revokeSession(actorOf(req), parse(idParam, req.params).id, meta(req));
  res.status(204).end();
}
