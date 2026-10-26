/**
 * Keyset pagination. A cursor is the (created_at, id) of the last row the client has,
 * encoded opaquely. It is exact because every timestamp column is timestamptz(3): the
 * cursor's millisecond Date equals the stored value (see db/migrations/0001_init.sql).
 * Lists ask for one more row than the page size to know whether a next page exists, so
 * no COUNT(*) is ever needed.
 *
 *   const { rows, nextCursor } = page(await query.where(before(cursor)).limit(limit + 1).execute(), limit);
 */
import { badRequest } from "./errors";

export interface Cursor {
  at: Date;
  id: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

export function encodeCursor(at: Date | string, id: string): string {
  const iso = at instanceof Date ? at.toISOString() : new Date(at).toISOString();
  return Buffer.from(`${iso}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 200) throw badRequest("Invalid cursor", "INVALID_CURSOR");
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const sep = decoded.indexOf("|");
  const at = new Date(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (sep < 1 || Number.isNaN(at.getTime()) || !/^[0-9A-Z]{26}$/.test(id)) throw badRequest("Invalid cursor", "INVALID_CURSOR");
  return { at, id };
}

export function parseLimit(raw: unknown, fallback = DEFAULT_LIMIT): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/** Trim the look-ahead row and build the next cursor from the last kept row. */
export function toPage<T>(
  rows: T[],
  limit: number,
  key: (row: T) => { at: Date | string; id: string },
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(key(last).at, key(last).id) : null };
}
