/**
 * Who is asking. Services take an `Actor` (or a nullable one for public reads) instead
 * of an Express request, so they are callable from routes, jobs and tests alike.
 */
import type { AdminArea, UserRole, UserStatus } from "@open-lms/types";
import { canOpenArea } from "../domain/admin-permissions";
import { forbidden, unauthenticated } from "./errors";

export interface Actor {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
}

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Platform staff (not instructors): support, finance and admins. */
export function isStaff(actor: Actor | null | undefined): boolean {
  return !!actor && (actor.role === "ADMIN" || actor.role === "SUPPORT" || actor.role === "FINANCE");
}

export function isAdmin(actor: Actor | null | undefined): boolean {
  return !!actor && actor.role === "ADMIN";
}

export function requireActor(actor: Actor | null | undefined): Actor {
  if (!actor) throw unauthenticated();
  return actor;
}

/** Writes need an ACTIVE account: suspended users can read but not post, review or submit. */
export function requireActive(actor: Actor | null | undefined): Actor {
  const a = requireActor(actor);
  if (a.status !== "ACTIVE") throw forbidden("Your account is restricted", "ACCOUNT_RESTRICTED");
  return a;
}

export function requireStaff(actor: Actor | null | undefined): Actor {
  const a = requireActor(actor);
  if (!isStaff(a)) throw forbidden();
  return a;
}

export function requireAdmin(actor: Actor | null | undefined): Actor {
  const a = requireActor(actor);
  if (!isAdmin(a)) throw forbidden();
  return a;
}

/** The actor's role may open this /admin area (domain/admin-permissions.ts), and the account is ACTIVE: a suspended operator has no powers. */
export function requireArea(actor: Actor | null | undefined, area: AdminArea): Actor {
  const a = requireActor(actor);
  if (!canOpenArea(a.role, area)) throw forbidden("You do not have access to this area", "FORBIDDEN_AREA");
  return requireActive(a);
}
