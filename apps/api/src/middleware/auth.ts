/**
 * Authentication. The bearer access token is verified, then the user is reloaded so a
 * suspension, ban or "sign out everywhere" takes effect on the very next request, not
 * when the token expires.
 */
import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../core/context";
import { forbidden, unauthenticated } from "../core/errors";
import { userRepo } from "../repositories/user.repository";
import { verifyAccessToken } from "../security/tokens";

export type AuthFailure = "MISSING" | "INVALID" | "BANNED" | "DEACTIVATED";

/** Resolve an access token to an Actor. Shared by HTTP middleware and the socket gateway. */
export async function actorFromToken(token: string | null | undefined): Promise<{ actor: Actor } | { failure: AuthFailure }> {
  if (!token) return { failure: "MISSING" };
  const claims = verifyAccessToken(token);
  if (!claims) return { failure: "INVALID" };
  const user = await userRepo.findAuthById(claims.sub);
  if (!user || user.token_version !== claims.ver) return { failure: "INVALID" };
  if (user.status === "BANNED") return { failure: "BANNED" };
  if (user.status === "DEACTIVATED") return { failure: "DEACTIVATED" };
  // A timed suspension that has run out is lifted lazily here and by the sweep job.
  const status = user.status === "SUSPENDED" && user.suspended_until && user.suspended_until <= new Date() ? "ACTIVE" : user.status;
  return { actor: { id: user.id, username: user.username, displayName: user.display_name, role: user.role, status } };
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const result = await actorFromToken(bearer(req));
  if ("failure" in result) {
    if (result.failure === "BANNED") throw forbidden("This account has been banned", "ACCOUNT_BANNED");
    if (result.failure === "DEACTIVATED") throw forbidden("This account is deactivated", "ACCOUNT_DEACTIVATED");
    throw unauthenticated(result.failure === "MISSING" ? "Sign in to continue" : "Session expired", result.failure === "MISSING" ? "UNAUTHENTICATED" : "TOKEN_INVALID");
  }
  req.actor = result.actor;
  next();
}

/** Attach the actor when a valid token is present; public otherwise. A bad token is ignored, not rejected. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearer(req);
  if (token) {
    const result = await actorFromToken(token);
    req.actor = "actor" in result ? result.actor : null;
  } else {
    req.actor = null;
  }
  next();
}

export function requireRole(...roles: Actor["role"][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) throw unauthenticated();
    if (!roles.includes(req.actor.role)) throw forbidden();
    next();
  };
}
