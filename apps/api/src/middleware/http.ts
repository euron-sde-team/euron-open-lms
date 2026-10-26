import type { Request } from "express";
import type { Actor, RequestMeta } from "../core/context";
import { unauthenticated } from "../core/errors";

export function meta(req: Request): RequestMeta {
  return { requestId: req.requestId, ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null };
}

/** The signed-in actor; routes behind `authenticate` always have one. */
export function actorOf(req: Request): Actor {
  if (!req.actor) throw unauthenticated();
  return req.actor;
}
