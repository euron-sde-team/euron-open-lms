import { describe, expect, it } from "vitest";
import { compactNumber, dayLabel, relativeTime } from "@/lib/time";

const NOW = new Date("2026-03-10T12:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
  it("says Just now for the last 45 seconds", () => {
    expect(relativeTime(ago(10_000), NOW)).toBe("Just now");
  });
  it("uses minutes, hours and days", () => {
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe("5m");
    expect(relativeTime(ago(3 * 3600_000), NOW)).toBe("3h");
    expect(relativeTime(ago(3 * 86400_000), NOW)).toBe("3d");
  });
  it("says Yesterday for the previous calendar day within 48 hours", () => {
    const d = new Date(NOW);
    d.setDate(d.getDate() - 1);
    d.setHours(8, 0, 0, 0);
    expect(relativeTime(d, NOW)).toBe("Yesterday");
  });
  it("falls back to a date, with the year only when it differs", () => {
    expect(relativeTime("2026-01-02T10:00:00Z", NOW, "en-US")).toBe("Jan 2");
    expect(relativeTime("2024-01-02T10:00:00Z", NOW, "en-US")).toBe("Jan 2, 2024");
  });
  it("handles the future (events) and invalid input", () => {
    expect(relativeTime(new Date(NOW + 2 * 86400_000), NOW, "en-US")).toBe("in 2 days");
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});

describe("dayLabel and compactNumber", () => {
  it("labels today and yesterday", () => {
    expect(dayLabel(NOW, NOW)).toBe("Today");
    expect(dayLabel(NOW - 86400_000, NOW)).toBe("Yesterday");
  });
  it("compacts counts", () => {
    expect(compactNumber(950, "en-US")).toBe("950");
    expect(compactNumber(1200, "en-US")).toBe("1.2K");
  });
});
