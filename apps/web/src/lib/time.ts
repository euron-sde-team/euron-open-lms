/**
 * Relative and absolute time with Intl only (no date library): "now", "5m",
 * "3h", "Yesterday", "Mar 4", "Mar 4, 2023", and full timestamps for tooltips.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function toDate(v: string | number | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Compact relative time for feeds and lists. */
export function relativeTime(value: string | number | Date, now: number | Date = Date.now(), locale?: string): string {
  const d = toDate(value);
  const ref = typeof now === "number" ? now : now.getTime();
  const diff = ref - d.getTime();
  if (Number.isNaN(diff)) return "";
  if (diff < 0) {
    // Future (events): "in 3 days".
    return futureTime(d, ref, locale);
  }
  if (diff < 45_000) return "Just now";
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MIN))}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 2 * DAY && isYesterday(d, ref)) return "Yesterday";
  if (diff < 7 * DAY) return `${Math.max(1, Math.floor(diff / DAY))}d`;
  const sameYear = d.getFullYear() === new Date(ref).getFullYear();
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
}

function isYesterday(d: Date, ref: number): boolean {
  const y = new Date(ref);
  y.setDate(y.getDate() - 1);
  return d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
}

function futureTime(d: Date, ref: number, locale?: string): string {
  const diff = d.getTime() - ref;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (diff < HOUR) return rtf.format(Math.max(1, Math.round(diff / MIN)), "minute");
  if (diff < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  if (diff < 30 * DAY) return rtf.format(Math.round(diff / DAY), "day");
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(d);
}

/** "Thursday, March 4, 2026 at 9:41 AM" for tooltips and title attributes. */
export function fullTimestamp(value: string | number | Date, locale?: string, timeZone?: string): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(d);
}

/** "9:41 AM" for chat bubbles. */
export function clockTime(value: string | number | Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(toDate(value));
}

/** Day divider label in chat: "Today", "Yesterday", "Monday, March 2". */
export function dayLabel(value: string | number | Date, now: number = Date.now(), locale?: string): string {
  const d = toDate(value);
  const today = new Date(now);
  if (sameDay(d, today)) return "Today";
  if (isYesterday(d, now)) return "Yesterday";
  const sameYear = d.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Event date range: "Mar 4, 9:00 AM to 11:00 AM" or across days. */
export function eventRange(startsAt: string, endsAt: string, timeZone?: string, locale?: string): string {
  const s = toDate(startsAt);
  const e = toDate(endsAt);
  const opts: Intl.DateTimeFormatOptions = { ...(timeZone ? { timeZone } : {}) };
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", ...opts });
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", ...opts });
  const sameDate = date.format(s) === date.format(e);
  return sameDate ? `${date.format(s)}, ${time.format(s)} to ${time.format(e)}` : `${date.format(s)}, ${time.format(s)} to ${date.format(e)}, ${time.format(e)}`;
}

/** Short count: 950, 1.2K, 3.4M. */
export function compactNumber(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
