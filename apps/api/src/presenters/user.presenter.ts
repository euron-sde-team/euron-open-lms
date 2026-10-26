import { EMAIL_CATEGORIES, PUSH_DEFAULTS, type EmailCategory, type Me, type UserSummary } from "@open-lms/types";
import { type Executor, db } from "../db/kysely";
import { isOperator } from "../domain/admin-permissions";
import { userRepo, type SummaryRow, type UserRow } from "../repositories/user.repository";
import { loadMedia, urlOf } from "./media.presenter";
import { liveSubscriptionOf } from "./subscription.presenter";

export type { SummaryRow };

export function toSummary(row: SummaryRow, avatarUrl: string | null): UserSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl,
    headline: row.headline,
    role: row.role,
  };
}

/** Batch-load UserSummary DTOs for a set of user ids. */
export async function loadSummaries(ids: readonly (string | null | undefined)[], exec: Executor = db): Promise<Map<string, UserSummary>> {
  const wanted = ids.filter((x): x is string => !!x);
  const rows = await userRepo.findSummaries(wanted, exec);
  const media = await loadMedia(rows.map((r) => r.avatar_upload_id), exec);
  return new Map(rows.map((r) => [r.id, toSummary(r, urlOf(media, r.avatar_upload_id, "thumb"))]));
}

export async function summaryOf(id: string, exec: Executor = db): Promise<UserSummary | null> {
  return (await loadSummaries([id], exec)).get(id) ?? null;
}

/** Missing keys mean "on": a new category never silently starts switched off. */
export function emailPreferences(stored: unknown): Record<EmailCategory, boolean> {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  return Object.fromEntries(EMAIL_CATEGORIES.map((c) => [c, s[c] !== false])) as Record<EmailCategory, boolean>;
}

/** Missing keys take PUSH_DEFAULTS (product updates start off on a phone). */
export function pushPreferences(stored: unknown): Record<EmailCategory, boolean> {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  return Object.fromEntries(EMAIL_CATEGORIES.map((c) => [c, typeof s[c] === "boolean" ? (s[c] as boolean) : PUSH_DEFAULTS[c]])) as Record<EmailCategory, boolean>;
}

export async function toMe(row: UserRow, exec: Executor = db): Promise<Me> {
  const [summary, subscription] = await Promise.all([summaryOf(row.id, exec), liveSubscriptionOf(row.id, exec)]);
  return {
    ...(summary as UserSummary),
    email: row.email,
    status: row.status,
    suspendedUntil: row.status === "SUSPENDED" && row.suspended_until ? row.suspended_until.toISOString() : null,
    emailVerified: !!row.email_verified_at,
    totpEnabled: row.totp_enabled,
    bio: row.bio,
    website: row.website,
    certificateName: row.certificate_name,
    preferredCurrency: row.preferred_currency,
    emailPreferences: emailPreferences(row.email_preferences),
    pushPreferences: pushPreferences(row.push_preferences),
    deletionRequestedAt: row.deletion_requested_at?.toISOString() ?? null,
    canOpenAdmin: isOperator(row.role),
    subscription,
  };
}
