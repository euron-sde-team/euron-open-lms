import { describe, expect, it } from "vitest";
import { createBeatAccumulator } from "@/lib/classroom/beat-accumulator";

/** Feeds samples every `stepMs` of wall time while the media advances `rate` x as fast. */
function play(acc: ReturnType<typeof createBeatAccumulator>, from: number, seconds: number, { rate = 1, stepMs = 250, wall0 = 0 } = {}) {
  let wall = wall0;
  let t = from;
  acc.feed(t, wall, rate);
  const steps = Math.round((seconds * 1000) / stepMs);
  for (let i = 0; i < steps; i++) {
    wall += stepMs;
    t += (stepMs / 1000) * rate;
    acc.feed(t, wall, rate);
  }
  return { wall, t };
}

describe("beat accumulator", () => {
  it("counts real playback in whole seconds and carries the fraction", () => {
    const acc = createBeatAccumulator();
    play(acc, 0, 10.5);
    expect(acc.take()).toBe(10);
    expect(acc.pending).toBeCloseTo(0.5, 5);
    expect(acc.take()).toBe(0);
  });

  it("does not count a seek forward", () => {
    const acc = createBeatAccumulator();
    const { wall } = play(acc, 0, 5);
    // Scrub to the end: a 500 s jump in 250 ms of wall time.
    acc.feed(505, wall + 250, 1);
    expect(acc.take()).toBe(5);
  });

  it("starts a new run after a discontinuity", () => {
    const acc = createBeatAccumulator();
    const { wall } = play(acc, 0, 3);
    acc.discontinuity();
    play(acc, 100, 2, { wall0: wall + 250 });
    expect(acc.take()).toBe(5);
  });

  it("counts media seconds at 2x speed", () => {
    const acc = createBeatAccumulator();
    play(acc, 0, 10, { rate: 2 });
    expect(acc.take()).toBe(20);
  });

  it("ignores backwards steps and the gap across a pause", () => {
    const acc = createBeatAccumulator();
    const { wall, t } = play(acc, 50, 4);
    acc.feed(t - 10, wall + 250, 1);
    expect(acc.take()).toBe(4);
    acc.pause();
    // Resumed a minute later at the same spot: nothing counts for the paused minute.
    acc.feed(t - 10, wall + 60_000, 1);
    acc.feed(t - 9.75, wall + 60_250, 1);
    expect(acc.pending).toBeCloseTo(0.25, 5);
  });

  it("does not credit a jump bigger than the wall clock allows", () => {
    const acc = createBeatAccumulator();
    acc.feed(0, 0, 1);
    acc.feed(3, 1000, 1); // 3 s of media in 1 s of wall clock at 1x
    expect(acc.pending).toBe(0);
    acc.feed(4, 2000, 1);
    expect(acc.pending).toBe(1);
  });
});
