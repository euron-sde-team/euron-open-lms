/**
 * Your own account: name, photo, headline and bio (instructors show these on course
 * pages), the name printed on certificates, the preferred display currency, email
 * switches, and signed-in sessions. Public instructor pages are in catalog.service.ts.
 */
import { EMAIL_CATEGORIES, type EmailCategory, type Me } from "@open-lms/types";
import type { Actor, RequestMeta } from "../core/context";
import { requireActive } from "../core/context";
import { badRequest, notFound } from "../core/errors";
import { db } from "../db/kysely";
import { cleanDisplayName } from "../domain/display-name";
import { safeUrl } from "../domain/safe-url";
import { emailPreferences, pushPreferences, toMe } from "../presenters/user.presenter";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo } from "../repositories/user.repository";
import { audit } from "./audit.service";
import { claimSingle } from "./media-attach.service";
import { getSettings } from "./settings.service";

export async function me(actor: Actor): Promise<Me> {
  const row = await userRepo.findById(actor.id);
  if (!row) throw notFound("User not found");
  return toMe(row);
}

export interface AccountPatch {
  displayName?: string;
  certificateName?: string | null;
  headline?: string | null;
  bio?: string | null;
  website?: string | null;
  avatarUploadId?: string | null;
  preferredCurrency?: string | null;
  emailPreferences?: Partial<Record<EmailCategory, boolean>>;
  pushPreferences?: Partial<Record<EmailCategory, boolean>>;
}

export async function updateMe(actor: Actor, patch: AccountPatch): Promise<Me> {
  requireActive(actor);
  const row0 = await userRepo.findById(actor.id);
  if (!row0) throw notFound("User not found");
  let displayName: string | undefined;
  if (patch.displayName !== undefined) {
    const cleaned = cleanDisplayName(patch.displayName);
    if (!cleaned) throw badRequest("Use your name, not an email address or phone number", "DISPLAY_NAME_INVALID");
    displayName = cleaned;
  }
  let certificateName: string | null | undefined;
  if (patch.certificateName !== undefined) {
    certificateName = patch.certificateName === null ? null : cleanDisplayName(patch.certificateName, 120);
    if (patch.certificateName !== null && !certificateName) throw badRequest("Use your name as it should appear on certificates", "CERTIFICATE_NAME_INVALID");
  }
  let website: string | null | undefined;
  if (patch.website !== undefined) {
    website = patch.website ? safeUrl(patch.website) : null;
    if (patch.website && !website) throw badRequest("Enter a valid http or https link", "URL_INVALID");
  }
  if (patch.preferredCurrency) {
    const { currencies } = await getSettings();
    if (!currencies.enabled.includes(patch.preferredCurrency)) throw badRequest("That currency is not offered", "CURRENCY_NOT_OFFERED");
  }
  const avatar = patch.avatarUploadId === undefined ? undefined : await claimSingle(actor.id, patch.avatarUploadId, "AVATAR");
  let prefs: string | undefined;
  if (patch.emailPreferences) {
    const merged = { ...emailPreferences(row0.email_preferences) };
    for (const c of EMAIL_CATEGORIES) if (typeof patch.emailPreferences[c] === "boolean") merged[c] = patch.emailPreferences[c] as boolean;
    prefs = JSON.stringify(merged);
  }
  let push: string | undefined;
  if (patch.pushPreferences) {
    const merged = { ...pushPreferences(row0.push_preferences) };
    for (const c of EMAIL_CATEGORIES) if (typeof patch.pushPreferences[c] === "boolean") merged[c] = patch.pushPreferences[c] as boolean;
    push = JSON.stringify(merged);
  }
  const row = await userRepo.update(actor.id, {
    ...(displayName !== undefined ? { display_name: displayName } : {}),
    ...(certificateName !== undefined ? { certificate_name: certificateName } : {}),
    ...(patch.headline !== undefined ? { headline: patch.headline?.trim() || null } : {}),
    ...(patch.bio !== undefined ? { bio: patch.bio?.trim() || null } : {}),
    ...(website !== undefined ? { website } : {}),
    ...(avatar !== undefined ? { avatar_upload_id: avatar } : {}),
    ...(patch.preferredCurrency !== undefined ? { preferred_currency: patch.preferredCurrency } : {}),
    ...(prefs !== undefined ? { email_preferences: prefs } : {}),
    ...(push !== undefined ? { push_preferences: push } : {}),
  });
  if (!row) throw notFound("User not found");
  return toMe(row);
}

/**
 * Active sessions. The access token does not name its session, so `current` marks the
 * most recently used session from this browser (same user agent).
 */
export async function sessions(actor: Actor, meta: RequestMeta) {
  const rows = await sessionRepo.listActive(actor.id);
  const currentId = rows.find((r) => r.user_agent === (meta.userAgent?.slice(0, 300) ?? null))?.id ?? null;
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.user_agent,
    ip: r.ip,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at.toISOString(),
    current: r.id === currentId,
  }));
}

export async function revokeSession(actor: Actor, sessionId: string, meta: RequestMeta): Promise<void> {
  const row = await db.selectFrom("sessions").select(["id", "family_id"]).where("id", "=", sessionId).where("user_id", "=", actor.id).where("revoked_at", "is", null).executeTakeFirst();
  if (!row) throw notFound("Session not found");
  await sessionRepo.revokeFamily(row.family_id);
  await audit({ actorId: actor.id, action: "session.revoke", entityType: "session", entityId: row.id, ip: meta.ip });
}
