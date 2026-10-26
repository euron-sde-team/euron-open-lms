/**
 * Measures the seconds of video that actually played, for the progress heartbeats.
 *
 * The player feeds every `timeupdate` (media time plus wall clock). A step forward
 * counts only when it is about what the wall clock and the playback rate allow, so a
 * seek, a scrub to the end or a jump after a stall never counts as watching. `take()`
 * hands out whole seconds and keeps the fraction for the next beat, so short beats
 * (pause after 0.4 s) are not lost to the server's rounding.
 */
export interface BeatAccumulator {
  /** A media time sample while playing. `nowMs` is the wall clock (performance.now or Date.now). */
  feed(mediaTime: number, nowMs: number, rate?: number): void;
  /** The playhead jumped (seeking, source reload): the next sample starts a new run. */
  discontinuity(): void;
  /** Playback paused or stopped: same as a discontinuity, the gap is not watching. */
  pause(): void;
  /** Whole seconds played since the last take; the remainder carries over. */
  take(): number;
  /** Total measured so far, including the untaken remainder (for tests and debugging). */
  readonly pending: number;
}

/** A sample step is accepted when it is within this factor of what the wall clock allows. */
const SLACK_FACTOR = 1.5;
/** Fixed slack for timer jitter, in seconds. */
const SLACK_SECONDS = 0.35;

export function createBeatAccumulator(): BeatAccumulator {
  let lastMedia: number | null = null;
  let lastWall = 0;
  let played = 0;

  return {
    feed(mediaTime, nowMs, rate = 1) {
      if (!Number.isFinite(mediaTime)) return;
      if (lastMedia === null) {
        lastMedia = mediaTime;
        lastWall = nowMs;
        return;
      }
      const step = mediaTime - lastMedia;
      const wall = Math.max(0, (nowMs - lastWall) / 1000);
      const allowed = wall * Math.max(0.25, rate) * SLACK_FACTOR + SLACK_SECONDS;
      if (step > 0 && step <= allowed) played += step;
      lastMedia = mediaTime;
      lastWall = nowMs;
    },
    discontinuity() {
      lastMedia = null;
    },
    pause() {
      lastMedia = null;
    },
    take() {
      const whole = Math.floor(played);
      played -= whole;
      return whole;
    },
    get pending() {
      return played;
    },
  };
}

/** The heartbeat cadence while playing. */
export const BEAT_INTERVAL_MS = 15_000;
