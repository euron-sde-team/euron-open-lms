/**
 * Video progress from player heartbeats, and what "done" means per item kind.
 *
 * A heartbeat carries where the playhead is and how many seconds actually played since
 * the last beat. Watched time only grows by what played (capped by wall-clock time
 * since the previous beat), so dragging the scrubber to the end does not complete a
 * lecture. Pure (test/unit/progress.test.ts).
 */

export interface StoredProgress {
  positionSeconds: number;
  furthestSeconds: number;
  watchedSeconds: number;
  completedAt: Date | null;
  updatedAt: Date | null;
}

export interface Beat {
  positionSeconds: number;
  playedSeconds: number;
}

export function applyBeat(prev: StoredProgress, beat: Beat, durationSeconds: number, now: Date): StoredProgress {
  const duration = Math.max(0, Math.round(durationSeconds));
  const position = clamp(Math.round(beat.positionSeconds), 0, duration || Number.MAX_SAFE_INTEGER);
  // A beat can claim at most the wall-clock time since the previous one (plus slack for
  // timer jitter, and 2x playback speed), and never more than 60 s.
  const elapsed = prev.updatedAt ? (now.getTime() - prev.updatedAt.getTime()) / 1000 : 60;
  const played = clamp(Math.round(beat.playedSeconds), 0, Math.min(60, Math.ceil(elapsed * 2 + 2)));
  const watched = duration ? Math.min(duration, prev.watchedSeconds + played) : prev.watchedSeconds + played;
  return {
    positionSeconds: position,
    furthestSeconds: Math.max(prev.furthestSeconds, Math.min(position, prev.furthestSeconds + played + 5)),
    watchedSeconds: watched,
    completedAt: prev.completedAt,
    updatedAt: now,
  };
}

/** Watched share of the video, 0..100. */
export function watchedPercent(p: Pick<StoredProgress, "watchedSeconds">, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return clamp(Math.floor((p.watchedSeconds * 100) / durationSeconds), 0, 100);
}

/**
 * When an item counts as done. The rule per kind:
 *   - a video, once `threshold` percent of it has actually been watched;
 *   - an article or a PDF, when the learner marks it done (opening it is not reading it);
 *   - a quiz, on the first passing attempt;
 *   - an assignment, when a reviewer approves a submission.
 * Quizzes and assignments complete from their own services, never from heartbeats.
 */
export function videoComplete(p: Pick<StoredProgress, "watchedSeconds">, durationSeconds: number, threshold: number): boolean {
  if (durationSeconds <= 0) return false;
  return watchedPercent(p, durationSeconds) >= threshold;
}

/** Course progress: completed items over all items, floored so 99.6% never shows as 100%. */
export function coursePercent(completed: number, total: number): number {
  if (total <= 0) return 0;
  return clamp(Math.floor((completed * 100) / total), 0, 100);
}

/** Consecutive days of activity ending today or yesterday (dates as YYYY-MM-DD, any order). */
export function streak(days: string[], today: string): number {
  const set = new Set(days);
  const d = new Date(`${today}T00:00:00Z`);
  if (!set.has(iso(d))) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  while (set.has(iso(d))) {
    n += 1;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
