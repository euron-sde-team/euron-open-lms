import { describe, expect, it } from "vitest";
import { PlayedMeter, clampTime, formatTime, hlsEngine, isExpiring, keyToAction, resumePoint, shouldIgnoreKeyTarget, sourceFromPlayback, spokenTime, stepSpeed, timeFromRatio, youtubeEmbedUrl } from "@/components/player/player-utils";

describe("time helpers", () => {
  it("formats the clock", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5.9)).toBe("0:05");
    expect(formatTime(185)).toBe("3:05");
    expect(formatTime(3729)).toBe("1:02:09");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });

  it("speaks the time", () => {
    expect(spokenTime(185)).toBe("3 minutes 5 seconds");
    expect(spokenTime(3601)).toBe("1 hour 1 second");
    expect(spokenTime(0)).toBe("0 seconds");
  });

  it("clamps seeks", () => {
    expect(clampTime(-4, 100)).toBe(0);
    expect(clampTime(140, 100)).toBe(100);
    expect(clampTime(50, Number.NaN)).toBe(50);
    expect(timeFromRatio(0.25, 200)).toBe(50);
    expect(timeFromRatio(1.4, 200)).toBe(200);
    expect(timeFromRatio(0.5, 0)).toBe(0);
  });

  it("honours a resume point only away from the ends", () => {
    expect(resumePoint(3, 600)).toBe(0);
    expect(resumePoint(120, 600)).toBe(120);
    expect(resumePoint(595, 600)).toBe(0);
    expect(resumePoint(120, Number.NaN)).toBe(120);
  });

  it("steps speeds and stops at the ends", () => {
    expect(stepSpeed(1, 1)).toBe(1.25);
    expect(stepSpeed(1, -1)).toBe(0.75);
    expect(stepSpeed(2, 1)).toBe(2);
    expect(stepSpeed(0.5, -1)).toBe(0.5);
    expect(stepSpeed(1.1, 1)).toBe(1.25);
  });
});

describe("keyboard", () => {
  it("maps the shortcuts", () => {
    expect(keyToAction({ key: " " })).toEqual({ type: "toggle" });
    expect(keyToAction({ key: "K" })).toEqual({ type: "toggle" });
    expect(keyToAction({ key: "j" })).toEqual({ type: "seekBy", seconds: -10 });
    expect(keyToAction({ key: "l" })).toEqual({ type: "seekBy", seconds: 10 });
    expect(keyToAction({ key: "ArrowLeft" })).toEqual({ type: "seekBy", seconds: -5 });
    expect(keyToAction({ key: "ArrowRight" })).toEqual({ type: "seekBy", seconds: 5 });
    expect(keyToAction({ key: "ArrowUp" })).toEqual({ type: "volumeBy", delta: 0.05 });
    expect(keyToAction({ key: "m" })).toEqual({ type: "toggleMute" });
    expect(keyToAction({ key: "f" })).toEqual({ type: "toggleFullscreen" });
    expect(keyToAction({ key: ">", shiftKey: true })).toEqual({ type: "speed", dir: 1 });
    expect(keyToAction({ key: "<", shiftKey: true })).toEqual({ type: "speed", dir: -1 });
    expect(keyToAction({ key: "4" })).toEqual({ type: "seekToPercent", percent: 40 });
    expect(keyToAction({ key: "Home" })).toEqual({ type: "home" });
  });

  it("leaves modifier combos and unknown keys alone", () => {
    expect(keyToAction({ key: "f", metaKey: true })).toBeNull();
    expect(keyToAction({ key: "k", ctrlKey: true })).toBeNull();
    expect(keyToAction({ key: "," })).toBeNull();
    expect(keyToAction({ key: "x" })).toBeNull();
  });

  it("does not steal keys from fields, buttons or sliders", () => {
    const el = (tagName: string, attrs: Record<string, string> = {}) => ({ tagName, isContentEditable: false, getAttribute: (n: string) => attrs[n] ?? null });
    expect(shouldIgnoreKeyTarget(el("INPUT"), "k")).toBe(true);
    expect(shouldIgnoreKeyTarget(el("TEXTAREA"), "j")).toBe(true);
    expect(shouldIgnoreKeyTarget(el("INPUT", { type: "range" }), "ArrowLeft")).toBe(true);
    expect(shouldIgnoreKeyTarget(el("INPUT", { type: "range" }), "k")).toBe(false);
    expect(shouldIgnoreKeyTarget(el("BUTTON"), " ")).toBe(true);
    expect(shouldIgnoreKeyTarget(el("BUTTON"), "k")).toBe(false);
    expect(shouldIgnoreKeyTarget(el("DIV"), " ")).toBe(false);
    expect(shouldIgnoreKeyTarget({ tagName: "DIV", isContentEditable: true }, "k")).toBe(true);
  });
});

describe("PlayedMeter", () => {
  it("counts played time and ignores seeks and pauses", () => {
    const m = new PlayedMeter();
    expect(m.tick(10, true)).toBe(0); // first sample
    expect(m.tick(10.5, true)).toBeCloseTo(0.5);
    expect(m.tick(11, true)).toBeCloseTo(0.5);
    expect(m.tick(60, true)).toBe(0); // a seek forward
    expect(m.tick(60.25, false)).toBe(0); // paused
    expect(m.tick(60.5, true)).toBeCloseTo(0.25);
    expect(m.take()).toBeCloseTo(1.3, 1);
    expect(m.take()).toBe(0);
  });

  it("allows bigger steps at higher speeds", () => {
    const m = new PlayedMeter();
    m.tick(0, true, 2);
    expect(m.tick(3.5, true, 2)).toBeCloseTo(3.5);
    m.reset(null);
    expect(m.tick(100, true)).toBe(0);
  });
});

describe("sources", () => {
  it("maps every provider", () => {
    expect(sourceFromPlayback({ provider: "EVS", manifestUrl: "https://v/x.m3u8", thumbnailsUrl: null, posterUrl: null, watermark: "ada@x", expiresAt: "2026-01-01T00:00:00Z", resumeAt: 30 })).toMatchObject({ type: "hls", url: "https://v/x.m3u8", watermark: "ada@x", resumeAt: 30 });
    expect(sourceFromPlayback({ provider: "MP4", url: "https://v/x.mp4", posterUrl: null, watermark: null, resumeAt: 0, expiresAt: null }).type).toBe("mp4");
    expect(sourceFromPlayback({ provider: "YOUTUBE", embedUrl: "https://www.youtube-nocookie.com/embed/abc", resumeAt: 12, watermark: null, expiresAt: null })).toMatchObject({ type: "youtube" });
  });

  it("adds a start time to YouTube embeds", () => {
    const u = new URL(youtubeEmbedUrl("https://www.youtube-nocookie.com/embed/abc", 42.7, true));
    expect(u.searchParams.get("start")).toBe("42");
    expect(u.searchParams.get("autoplay")).toBe("1");
  });

  it("picks native HLS on Safari and iOS, hls.js elsewhere", () => {
    const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
    const iosChrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
    expect(hlsEngine({ userAgent: safari, canPlayNative: true, mseSupported: true })).toBe("native");
    expect(hlsEngine({ userAgent: iosChrome, canPlayNative: true, mseSupported: false })).toBe("native");
    expect(hlsEngine({ userAgent: chrome, canPlayNative: true, mseSupported: true })).toBe("hlsjs");
    expect(hlsEngine({ userAgent: chrome, canPlayNative: false, mseSupported: false })).toBe("none");
  });

  it("knows when a signed source is about to expire", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(isExpiring("2026-01-01T00:00:10Z", now)).toBe(true);
    expect(isExpiring("2026-01-01T01:00:00Z", now)).toBe(false);
    expect(isExpiring(null, now)).toBe(false);
  });
});
