/**
 * Keyset cursors for every list, including ranked ones. Time cursors carry the
 * exact database value, read as text with `atKey(...)`, so they stay exact whatever the
 * column precision (the schema uses timestamptz(3), which also makes core/cursor.ts's
 * Date-based cursors exact; this module adds the score and hot shapes).
 *
 * Three shapes, all opaque base64url JSON:
 *   time   [at, id]            (created_at, id) lists
 *   score  [score, id]         ranked lists (top), score is a float8 from SQL
 *   hot    [score, ref, id]    hot lists also pin "now", so a page boundary does not
 *                              move while scores decay
 */
import { sql, type Expression, type SqlBool } from "kysely";
import { badRequest } from "../core/errors";
import { ID_PATTERN } from "../core/ids";

export interface TimeKey {
  at: string;
  id: string;
}
export interface ScoreKey {
  score: number;
  id: string;
  ref?: string;
}

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00$/;

/** Select a timestamptz column as exact UTC text, aliased `alias` (default "_at"). */
export function atKey<A extends string = "_at">(column: string, alias: A = "_at" as A) {
  return sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00"')`.as(alias);
}

function encode(parts: unknown[]): string {
  return Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

function decodeParts(raw: unknown): unknown[] | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 300) throw badRequest("Invalid cursor", "INVALID_CURSOR");
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch {
    throw badRequest("Invalid cursor", "INVALID_CURSOR");
  }
}

export function encodeTime(at: string, id: string): string {
  return encode([at, id]);
}

export function decodeTime(raw: unknown): TimeKey | null {
  const p = decodeParts(raw);
  if (!p) return null;
  const [at, id] = p;
  if (p.length !== 2 || typeof at !== "string" || !AT.test(at) || typeof id !== "string" || !ID_PATTERN.test(id)) throw badRequest("Invalid cursor", "INVALID_CURSOR");
  return { at, id };
}

export function encodeScore(score: number, id: string, ref?: string): string {
  return encode(ref ? [score, ref, id] : [score, id]);
}

export function decodeScore(raw: unknown): ScoreKey | null {
  const p = decodeParts(raw);
  if (!p) return null;
  const score = p[0];
  const id = p[p.length - 1];
  const ref = p.length === 3 ? p[1] : undefined;
  if ((p.length !== 2 && p.length !== 3) || typeof score !== "number" || !Number.isFinite(score) || typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw badRequest("Invalid cursor", "INVALID_CURSOR");
  }
  if (ref !== undefined && (typeof ref !== "string" || !AT.test(ref))) throw badRequest("Invalid cursor", "INVALID_CURSOR");
  return { score, id, ...(ref ? { ref } : {}) };
}

/** Rows strictly after the cursor in (at DESC, id DESC) order. */
export function olderThan(atColumn: string, idColumn: string, key: TimeKey | null): (eb: unknown) => Expression<SqlBool> {
  return () => (key ? sql<boolean>`(${sql.ref(atColumn)}, ${sql.ref(idColumn)}) < (${key.at}::timestamptz, ${key.id})` : sql<boolean>`true`);
}

/** Rows strictly after the cursor in (at ASC, id ASC) order. */
export function newerThan(atColumn: string, idColumn: string, key: TimeKey | null): (eb: unknown) => Expression<SqlBool> {
  return () => (key ? sql<boolean>`(${sql.ref(atColumn)}, ${sql.ref(idColumn)}) > (${key.at}::timestamptz, ${key.id})` : sql<boolean>`true`);
}

/** Rows strictly after the cursor in (score DESC, id DESC) order, for any score expression. */
export function belowScore(scoreExpr: Expression<number>, idColumn: string, key: ScoreKey | null): (eb: unknown) => Expression<SqlBool> {
  return () => (key ? sql<boolean>`(${scoreExpr}, ${sql.ref(idColumn)}) < (${key.score}::float8, ${key.id})` : sql<boolean>`true`);
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

/** Trim the look-ahead row and build the cursor from the last kept row. */
export function pageBy<T>(rows: T[], limit: number, cursorOf: (last: T) => string): Paged<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last !== undefined ? cursorOf(last) : null };
}

export function timePage<T extends { _at: string; id: string }>(rows: T[], limit: number): Paged<T> {
  return pageBy(rows, limit, (r) => encodeTime(r._at, r.id));
}
