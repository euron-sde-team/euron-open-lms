/** Pure helpers for the admin control plane (tested in test/admin). */

export interface Threshold {
  review: number;
  hide: number;
}

/** Errors per category: values must be within 0..1 and review must not exceed hide. */
export function thresholdErrors(t: Record<string, Threshold>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    if (!(v.review >= 0 && v.review <= 1) || !(v.hide >= 0 && v.hide <= 1)) out[k] = "Values must be between 0 and 1.";
    else if (v.review > v.hide) out[k] = "The review threshold must be at or below the hide threshold.";
  }
  return out;
}

/** SVG path for a sparkline through `values` in a `w` by `h` box (with padding). */
export function sparklinePath(values: number[], w: number, h: number, pad = 2): { line: string; area: string; max: number } {
  if (!values.length) return { line: "", area: "", max: 0 };
  const max = Math.max(...values, 0);
  const innerH = h - pad * 2;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = max > 0 ? pad + innerH - (v / max) * innerH : pad + innerH;
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const area = `${line} L${last[0]} ${h - pad} L${first[0]} ${h - pad} Z`;
  return { line, area, max };
}

/** "Chrome on macOS" from a user agent string. */
export function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl|node|okhttp|axios/i.test(ua)
              ? "App or script"
              : "Browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return os ? `${browser} on ${os}` : browser;
}

/** Whole days since an ISO date. */
export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** YYYY-MM-DD for a local date (the API reads dates in the analytics timezone). */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The last `days` days, today included. */
export function presetRange(days: number, now = new Date()): { from: string; to: string } {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(now) };
}

/** Inclusive length of a date range in days (0 when invalid). */
export function rangeDays(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** The domain part of an email, lowercased. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

/** A ratio 0..1 as a whole percentage, or a dash when unknown. */
export function percent(v: number | null | undefined): string {
  return v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The part of `next` that differs from `base`, two levels deep (the settings document
 * is merged key by key on the server, so unchanged keys are left out of the PATCH).
 * Arrays are replaced whole. Nested records one level below a group (thresholds,
 * premoderateNewAccounts) are diffed key by key too.
 */
export function settingsDiff<T extends Record<string, unknown>>(base: T, next: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(next)) {
    const a = base[key];
    const b = next[key];
    if (same(a, b)) continue;
    if (isPlainObject(a) && isPlainObject(b)) {
      const group: Record<string, unknown> = {};
      for (const k of Object.keys(b)) {
        if (same(a[k], b[k])) continue;
        const inner = a[k];
        const innerNext = b[k];
        if (isPlainObject(inner) && isPlainObject(innerNext)) {
          group[k] = Object.fromEntries(Object.entries(innerNext).filter(([ik, iv]) => !same(inner[ik], iv)));
        } else group[k] = innerNext;
      }
      out[key] = group;
    } else out[key] = b;
  }
  return out as Partial<T>;
}

/** How many leaf values a settings diff changes (for the "3 changes" save bar). */
export function countChanges(diff: unknown, depth = 0): number {
  // A whole threshold category ({ review, hide }) counts as one change.
  if (!isPlainObject(diff) || depth >= 3) return 1;
  return Object.values(diff).reduce<number>((n, v) => n + (isPlainObject(v) ? countChanges(v, depth + 1) : 1), 0);
}

export interface FieldChange {
  path: string;
  before: unknown;
  after: unknown;
}

/** Leaf-level changes between two JSON values (audit before/after), paths dotted. */
export function jsonChanges(before: unknown, after: unknown, path = ""): FieldChange[] {
  if (same(before, after)) return [];
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((k) => jsonChanges(before[k], after[k], path ? `${path}.${k}` : k));
  }
  return [{ path: path || "(value)", before, after }];
}

/** A short, readable rendering of a JSON value for a diff cell. */
export function formatJsonValue(v: unknown): string {
  if (v === undefined) return "(not set)";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

/** Split a pasted list of domains (commas, spaces or new lines) into clean, unique entries. */
export function parseDomains(input: string, existing: readonly string[] = []): { added: string[]; invalid: string[] } {
  const seen = new Set(existing);
  const added: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const d = raw.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) continue;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) invalid.push(raw.trim());
    else if (!seen.has(d)) {
      seen.add(d);
      added.push(d);
    }
  }
  return { added, invalid };
}
