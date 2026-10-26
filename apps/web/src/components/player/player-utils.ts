/**
 * Pure helpers behind the video player: sources from a `Playback`, the clock, seeking,
 * speeds, keyboard shortcuts and a played-time meter. No React and no DOM here, so the
 * classroom (which extends the player) and the unit tests can use them directly.
 */
import type { Playback } from "@open-lms/types";

/** What the player can load. Built from a `Playback` with `sourceFromPlayback`. */
export type PlayerSource =
  /** An HLS manifest (EVS or plain HLS): native on Safari/iOS, hls.js elsewhere. */
  | { type: "hls"; url: string; posterUrl: string | null; thumbnailsUrl: string | null; watermark: string | null; resumeAt: number; expiresAt: string | null }
  /** A progressive MP4, set as the <video> src. */
  | { type: "mp4"; url: string; posterUrl: string | null; thumbnailsUrl: null; watermark: string | null; resumeAt: number; expiresAt: null }
  /** A YouTube embed: YouTube draws its own controls. */
  | { type: "youtube"; url: string; posterUrl: null; thumbnailsUrl: null; watermark: null; resumeAt: number; expiresAt: null };

export function sourceFromPlayback(p: Playback): PlayerSource {
  switch (p.provider) {
    case "EVS":
      return { type: "hls", url: p.manifestUrl, posterUrl: p.posterUrl, thumbnailsUrl: p.thumbnailsUrl, watermark: p.watermark, resumeAt: p.resumeAt, expiresAt: p.expiresAt };
    case "HLS":
      return { type: "hls", url: p.url, posterUrl: p.posterUrl, thumbnailsUrl: null, watermark: p.watermark, resumeAt: p.resumeAt, expiresAt: null };
    case "MP4":
      return { type: "mp4", url: p.url, posterUrl: p.posterUrl, thumbnailsUrl: null, watermark: p.watermark, resumeAt: p.resumeAt, expiresAt: null };
    case "YOUTUBE":
      return { type: "youtube", url: p.embedUrl, posterUrl: null, thumbnailsUrl: null, watermark: null, resumeAt: p.resumeAt, expiresAt: null };
  }
}

/** The embed URL with a start time and the privacy-friendly flags. */
export function youtubeEmbedUrl(embedUrl: string, startAt = 0, autoplay = false): string {
  try {
    const u = new URL(embedUrl);
    if (startAt > 0) u.searchParams.set("start", String(Math.floor(startAt)));
    u.searchParams.set("rel", "0");
    u.searchParams.set("modestbranding", "1");
    u.searchParams.set("playsinline", "1");
    if (autoplay) u.searchParams.set("autoplay", "1");
    return u.toString();
  } catch {
    return embedUrl;
  }
}

/** Player clock: "0:05", "3:05", "1:02:09". Non-finite (live, not loaded) reads "0:00". */
export function formatTime(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Spoken form for screen readers: "3 minutes 5 seconds of 10 minutes". */
export function spokenTime(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const part = (n: number, unit: string) => (n ? `${n} ${unit}${n === 1 ? "" : "s"}` : "");
  return [part(h, "hour"), part(m, "minute"), part(r, "second")].filter(Boolean).join(" ") || "0 seconds";
}

/** Keep a target time inside [0, duration] (duration unknown: only the lower bound). */
export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t)) return 0;
  const upper = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(0, t), upper);
}

/** A seek bar position (pointer x inside the bar) as a time. */
export function timeFromRatio(ratio: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return clampTime(Math.min(1, Math.max(0, ratio)) * duration, duration);
}

/** Where the resume point is worth honouring: not in the first 5 s and not in the last 10 s. */
export function resumePoint(resumeAt: number, duration: number): number {
  if (!Number.isFinite(resumeAt) || resumeAt < 5) return 0;
  if (Number.isFinite(duration) && duration > 0 && resumeAt > duration - 10) return 0;
  return resumeAt;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** The next speed up (dir 1) or down (dir -1), clamped at the ends. */
export function stepSpeed(current: number, dir: 1 | -1): number {
  const idx = SPEEDS.findIndex((s) => Math.abs(s - current) < 0.001);
  if (idx === -1) {
    // An off-list speed: move to the nearest listed one in that direction.
    const next = dir === 1 ? SPEEDS.find((s) => s > current) : [...SPEEDS].reverse().find((s) => s < current);
    return next ?? current;
  }
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, idx + dir))]!;
}

export function speedLabel(s: number): string {
  return s === 1 ? "Normal" : `${s}x`;
}

/** What a key press asks the player to do. */
export type PlayerAction =
  | { type: "toggle" }
  | { type: "seekBy"; seconds: number }
  | { type: "seekToPercent"; percent: number }
  | { type: "volumeBy"; delta: number }
  | { type: "toggleMute" }
  | { type: "toggleFullscreen" }
  | { type: "speed"; dir: 1 | -1 }
  | { type: "home" }
  | { type: "end" };

export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * The shortcuts (YouTube-style): space or k play/pause; j / l back and forward 10 s;
 * left / right 5 s; up / down volume; m mute; f fullscreen; < / > speed; 0-9 jump to
 * that tenth; Home / End. Modifier combos are left to the browser.
 */
export function keyToAction(e: KeyLike): PlayerAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (key) {
    case " ":
    case "k":
      return { type: "toggle" };
    case "j":
      return { type: "seekBy", seconds: -10 };
    case "l":
      return { type: "seekBy", seconds: 10 };
    case "ArrowLeft":
      return { type: "seekBy", seconds: -5 };
    case "ArrowRight":
      return { type: "seekBy", seconds: 5 };
    case "ArrowUp":
      return { type: "volumeBy", delta: 0.05 };
    case "ArrowDown":
      return { type: "volumeBy", delta: -0.05 };
    case "m":
      return { type: "toggleMute" };
    case "f":
      return { type: "toggleFullscreen" };
    case "<":
    case ",":
      return e.key === "<" || e.shiftKey ? { type: "speed", dir: -1 } : null;
    case ">":
    case ".":
      return e.key === ">" || e.shiftKey ? { type: "speed", dir: 1 } : null;
    case "Home":
      return { type: "home" };
    case "End":
      return { type: "end" };
    default:
      if (/^[0-9]$/.test(key) && !e.shiftKey) return { type: "seekToPercent", percent: Number(key) * 10 };
      return null;
  }
}

/** Do not steal keys from text fields, buttons (space), sliders (arrows) or menus. */
export function shouldIgnoreKeyTarget(target: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null, key: string): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (target.isContentEditable || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target.getAttribute?.("type") ?? "text").toLowerCase();
    if (type !== "range") return true;
    return key.startsWith("Arrow") || key === "Home" || key === "End";
  }
  const role = target.getAttribute?.("role");
  if (role === "menuitem" || role === "menuitemradio" || role === "slider") return true;
  if ((tag === "BUTTON" || tag === "A") && (key === " " || key === "Enter")) return true;
  return false;
}

export function clampVolume(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}

/**
 * Counts seconds actually played: the time between consecutive `timeupdate`s while
 * playing, ignoring seeks (a jump bigger than `maxStep` real seconds at the current
 * speed). The classroom sends it as `ProgressBeat.playedSeconds`.
 */
export class PlayedMeter {
  private last: number | null = null;
  private total = 0;
  constructor(private readonly maxStep = 2) {}

  /** Feed the current position; returns the seconds credited by this tick. */
  tick(position: number, playing: boolean, rate = 1): number {
    if (!Number.isFinite(position)) return 0;
    const prev = this.last;
    this.last = position;
    if (!playing || prev === null) return 0;
    const d = position - prev;
    if (d <= 0 || d > this.maxStep * Math.max(1, rate)) return 0;
    this.total += d;
    return d;
  }

  /** A seek happened: the next tick starts a new segment. */
  reset(position: number | null = null) {
    this.last = position;
  }

  /** Read and zero the accumulated seconds (one heartbeat's worth). */
  take(): number {
    const t = this.total;
    this.total = 0;
    return Math.round(t * 10) / 10;
  }

  peek(): number {
    return this.total;
  }
}

/** True for an HTTP status that means the signed media URL expired or was refused. */
export function isAuthStatus(status: number | undefined | null): boolean {
  return status === 401 || status === 403;
}

/** True when a signed source is within `marginMs` of its expiry (refresh before seeking far). */
export function isExpiring(expiresAt: string | null, now = Date.now(), marginMs = 30_000): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t - now < marginMs;
}

/**
 * Which engine plays an HLS source. Safari (macOS and every iOS browser) plays HLS
 * natively (AES-128 included); elsewhere hls.js plays it over MSE. Without
 * MSE (old iOS) native is the only option.
 */
export function hlsEngine(env: { userAgent: string; canPlayNative: boolean; mseSupported: boolean }): "native" | "hlsjs" | "none" {
  const ua = env.userAgent;
  const isIOS = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));
  const isSafari = /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android)\//.test(ua);
  if ((isIOS || isSafari) && env.canPlayNative) return "native";
  if (env.mseSupported) return "hlsjs";
  return env.canPlayNative ? "native" : "none";
}
