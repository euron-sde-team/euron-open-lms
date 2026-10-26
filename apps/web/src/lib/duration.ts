/** Course and lesson lengths: "6 h 20 min", "45 min", "3:05" for players. */

export function formatDuration(seconds: number, opts: { short?: boolean } = {}): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return m === 0 ? (s > 0 ? "1 min" : "0 min") : `${m} min`;
  if (opts.short) return m ? `${h}h ${m}m` : `${h}h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Player clock: "3:05", "1:02:09". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** "BEGINNER" -> "Beginner", "ALL_LEVELS" -> "All levels". */
export function levelLabel(level: string): string {
  const t = level.toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "en" -> "English" in the viewer's language, falling back to the code. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
