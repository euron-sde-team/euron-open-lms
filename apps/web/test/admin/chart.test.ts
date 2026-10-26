import { describe, expect, it } from "vitest";
import { formatDay, formatTick, indexAt, labelIndexes, niceTicks, scaleLinear } from "@/components/admin/shell/chart";

describe("niceTicks", () => {
  it("rounds the top up to a nice step and starts at zero", () => {
    expect(niceTicks(87)).toEqual({ ticks: [0, 25, 50, 75, 100], max: 100 });
    expect(niceTicks(9)).toEqual({ ticks: [0, 2.5, 5, 7.5, 10], max: 10 });
    expect(niceTicks(1234).max).toBe(1500);
  });
  it("never uses fractional steps for small counts", () => {
    expect(niceTicks(3)).toEqual({ ticks: [0, 1, 2, 3], max: 3 });
    expect(niceTicks(2).ticks.every(Number.isInteger)).toBe(true);
  });
  it("allows fractions when asked", () => {
    expect(niceTicks(2, 4, false).ticks).toEqual([0, 0.5, 1, 1.5, 2]);
  });
  it("gives a unit axis for empty or zero data", () => {
    expect(niceTicks(0)).toEqual({ ticks: [0, 1], max: 1 });
    expect(niceTicks(Number.NaN)).toEqual({ ticks: [0, 1], max: 1 });
  });
});

describe("scales and positions", () => {
  it("maps linearly, including inverted ranges", () => {
    const y = scaleLinear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
    expect(y(100)).toBe(0);
  });
  it("survives a zero-width domain", () => {
    expect(scaleLinear([5, 5], [0, 10])(5)).toBe(0);
  });
  it("finds the nearest point and clamps outside the plot", () => {
    expect(indexAt(0, 5, 40, 440)).toBe(0);
    expect(indexAt(240, 5, 40, 440)).toBe(2);
    expect(indexAt(9999, 5, 40, 440)).toBe(4);
    expect(indexAt(100, 1, 40, 440)).toBe(0);
  });
  it("labels at most max dates, keeping the first and last", () => {
    expect(labelIndexes(3, 6)).toEqual([0, 1, 2]);
    const l = labelIndexes(30, 6);
    expect(l.length).toBeLessThanOrEqual(6);
    expect(l[0]).toBe(0);
    expect(l.at(-1)).toBe(29);
    expect(labelIndexes(0)).toEqual([]);
  });
});

describe("formatting", () => {
  it("reads ISO days as calendar dates without a timezone shift", () => {
    expect(formatDay("2026-03-04", { month: "short", day: "numeric" }, "en-US")).toBe("Mar 4");
    expect(formatDay("2026-01-01", { year: "numeric", month: "2-digit", day: "2-digit" }, "en-US")).toBe("01/01/2026");
    expect(formatDay("nonsense")).toBe("nonsense");
  });
  it("compacts large axis figures only", () => {
    expect(formatTick(950, "en-US")).toBe("950");
    expect(formatTick(2500, "en-US")).toBe("2,500");
    expect(formatTick(25000, "en-US")).toBe("25K");
  });
});
