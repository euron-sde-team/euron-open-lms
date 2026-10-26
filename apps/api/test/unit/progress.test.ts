import { describe, expect, it } from "vitest";
import { applyBeat, coursePercent, streak, videoComplete, watchedPercent } from "../../src/domain/progress";
import { flatten, moveAcross, moveWithin, neighbours, positions, resumeTarget } from "../../src/domain/curriculum";

const t0 = new Date("2026-01-01T00:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const fresh = { positionSeconds: 0, furthestSeconds: 0, watchedSeconds: 0, completedAt: null, updatedAt: null };

describe("video heartbeats", () => {
  it("adds what actually played", () => {
    const p = applyBeat({ ...fresh, updatedAt: t0 }, { positionSeconds: 15, playedSeconds: 15 }, 600, at(15));
    expect(p).toMatchObject({ positionSeconds: 15, watchedSeconds: 15, furthestSeconds: 15 });
  });

  it("does not let a scrub to the end count as watching", () => {
    const p = applyBeat({ ...fresh, updatedAt: t0 }, { positionSeconds: 590, playedSeconds: 0 }, 600, at(5));
    expect(p.watchedSeconds).toBe(0);
    expect(p.positionSeconds).toBe(590);
    expect(p.furthestSeconds).toBeLessThan(10);
  });

  it("caps a beat by wall-clock time since the last one", () => {
    const p = applyBeat({ ...fresh, updatedAt: t0 }, { positionSeconds: 60, playedSeconds: 600 }, 6000, at(10));
    expect(p.watchedSeconds).toBe(22);
  });

  it("never exceeds the duration and completes at the threshold", () => {
    let p = { ...fresh, updatedAt: t0 } as ReturnType<typeof applyBeat>;
    for (let s = 15; s <= 200; s += 15) p = applyBeat(p, { positionSeconds: s, playedSeconds: 15 }, 120, at(s));
    expect(p.watchedSeconds).toBe(120);
    expect(watchedPercent(p, 120)).toBe(100);
    expect(videoComplete({ watchedSeconds: 107 }, 120, 90)).toBe(false);
    expect(videoComplete({ watchedSeconds: 108 }, 120, 90)).toBe(true);
    expect(videoComplete({ watchedSeconds: 10 }, 0, 90)).toBe(false);
  });
});

describe("course rollup", () => {
  it("floors so 99.x% never shows as 100%", () => {
    expect(coursePercent(199, 200)).toBe(99);
    expect(coursePercent(0, 0)).toBe(0);
    expect(coursePercent(3, 3)).toBe(100);
  });

  it("counts a streak ending today or yesterday", () => {
    expect(streak(["2026-01-03", "2026-01-02", "2026-01-01"], "2026-01-03")).toBe(3);
    expect(streak(["2026-01-02", "2026-01-01"], "2026-01-03")).toBe(2);
    expect(streak(["2026-01-01"], "2026-01-03")).toBe(0);
  });
});

describe("curriculum ordering", () => {
  it("moves within a list and renumbers densely", () => {
    expect(moveWithin(["a", "b", "c", "d"], "d", 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveWithin(["a", "b"], "a", 99)).toEqual(["b", "a"]);
    expect(moveWithin(["a", "b"], "zzz", 0)).toEqual(["a", "b"]);
    expect(positions(["x", "y"])).toEqual([["x", 0], ["y", 1]]);
  });

  it("moves across lists", () => {
    expect(moveAcross(["a", "b"], ["c"], "a", 0)).toEqual({ source: ["b"], target: ["a", "c"] });
  });

  it("finds neighbours and where to resume", () => {
    const order = flatten([{ items: [{ id: "1" }, { id: "2" }] }, { items: [{ id: "3" }] }]).map((i) => i.id);
    expect(neighbours(order, "2")).toEqual({ prev: "1", next: "3" });
    expect(neighbours(order, "1").prev).toBeNull();
    expect(resumeTarget(order, new Set(["1"]), null)).toBe("2");
    expect(resumeTarget(order, new Set(["1"]), "3")).toBe("3");
    expect(resumeTarget(order, new Set(["1", "2", "3"]), "2")).toBe("2");
    expect(resumeTarget([], new Set(), null)).toBeNull();
  });
});
