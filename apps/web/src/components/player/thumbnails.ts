/** Seek-bar previews from a WebVTT thumbnails track (sprite sheets addressed with #xywh=). */

export interface ThumbCue {
  start: number;
  end: number;
  url: string;
  /** The sprite region, when the cue addresses part of an image. */
  rect: { x: number; y: number; w: number; h: number } | null;
}

function vttTime(s: string): number {
  const parts = s.trim().split(":");
  let secs = 0;
  for (const p of parts) secs = secs * 60 + parseFloat(p);
  return Number.isFinite(secs) ? secs : 0;
}

function resolveUrl(ref: string, base: string): string {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

/** Parses the VTT text; image references resolve against the track URL (signed query strings are kept on absolute refs). */
export function parseThumbnailVtt(text: string, baseUrl: string): ThumbCue[] {
  const cues: ThumbCue[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.includes("-->")) continue;
    const [a, b] = line.split("-->");
    const target = (lines[i + 1] ?? "").trim();
    if (!a || !b || !target) continue;
    const [ref, hash] = target.split("#");
    let rect: ThumbCue["rect"] = null;
    const m = hash?.match(/xywh=(\d+),(\d+),(\d+),(\d+)/);
    if (m) rect = { x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]! };
    cues.push({ start: vttTime(a), end: vttTime(b.split(/\s/).filter(Boolean)[0] ?? "0"), url: resolveUrl(ref!, baseUrl), rect });
    i++;
  }
  return cues;
}

export function cueAt(cues: ThumbCue[], t: number): ThumbCue | null {
  if (!cues.length) return null;
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid]!;
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return c;
  }
  return null;
}
