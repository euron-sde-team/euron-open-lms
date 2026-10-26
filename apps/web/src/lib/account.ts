import { isApiError } from "@open-lms/api-client";

/** Copy for a failed data export. */
export function exportErrorMessage(e: unknown, fallback: (e: unknown) => string): string {
  if (isApiError(e) && e.status === 429) return "You can export 3 times a day. Try again tomorrow.";
  return fallback(e);
}

/**
 * The company page that blocks deletion (409 OWNER_MUST_TRANSFER): the account is its only
 * owner while teammates remain. Null when the error is something else.
 */
export function ownedCompany(e: unknown): { name: string; slug: string } | null {
  if (!isApiError(e) || e.code !== "OWNER_MUST_TRANSFER") return null;
  const c = (e.details as { company?: { name?: unknown; slug?: unknown } } | null | undefined)?.company;
  return { name: typeof c?.name === "string" ? c.name : "your company", slug: typeof c?.slug === "string" ? c.slug : "" };
}
