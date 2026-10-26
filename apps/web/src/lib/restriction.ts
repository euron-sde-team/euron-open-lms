import type { Me } from "@open-lms/types";
import { fullTimestamp } from "./time";

/** A suspended account can read but not post, comment, answer or message. */
export function isRestricted(user: Pick<Me, "status"> | null | undefined): boolean {
  return user?.status === "SUSPENDED";
}

/** Banner copy: with the end date when the API reports it. */
export function restrictionMessage(until: string | null | undefined, locale?: string, timeZone?: string): string {
  if (!until) return "Your account is restricted.";
  return `Your account is restricted until ${fullTimestamp(until, locale, timeZone)}.`;
}
