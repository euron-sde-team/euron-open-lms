/**
 * euron-video-system (EVS): where EVS lectures play from. The LMS never uploads or
 * transcodes video itself; staff upload in EVS and paste (or pick) the video id.
 *
 *   mintPlayback   POST /v1/videos/{id}/playback-sessions   key scope playback:mint
 *                  Called only after the LMS's own entitlement check
 *                  (services/access.service.ts), with the learner's id as viewerId.
 *   listVideos     GET  /v1/videos                          key scope videos:read
 *                  The admin video picker; optional.
 *   verifyWebhook  EVS-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *                  video.ready / video.failed flip lectures.video_status.
 *
 * The playback key never reaches a browser: the browser only ever gets the session's
 * manifest URL, which carries a short-lived token bound to that viewer and video.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config, evsEnabled, isRealKey } from "../core/config";
import { HttpError } from "../core/errors";

const TIMEOUT_MS = 10_000;
const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface EvsSession {
  sessionId: string;
  expiresAt: string;
  manifestUrl: string;
  thumbnailsUrl: string | null;
  posterUrl: string | null;
  watermark: { required: boolean; text: string } | null;
}

export interface EvsVideoRow {
  id: string;
  title: string;
  status: string;
  durationSeconds: number | null;
  posterUrl: string | null;
  createdAt: string;
}

function base(): string {
  return (config.EVS_BASE_URL ?? "").replace(/\/+$/, "");
}

async function call(path: string, key: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, "The video service is not reachable", "VIDEO_SERVICE_UNAVAILABLE");
  }
  return res;
}

export async function mintPlayback(videoId: string, viewerId: string, origin: string): Promise<EvsSession> {
  if (!evsEnabled()) throw new HttpError(503, "Video playback is not configured on this server", "VIDEO_NOT_CONFIGURED");
  const res = await call(`/v1/videos/${encodeURIComponent(videoId)}/playback-sessions`, config.EVS_PLAYBACK_KEY as string, {
    method: "POST",
    body: JSON.stringify({ viewerId, origin }),
  });
  if (res.status === 404) throw new HttpError(404, "This video is not available", "VIDEO_NOT_FOUND");
  if (res.status === 422) throw new HttpError(409, "This video is still processing", "VIDEO_NOT_READY");
  if (!res.ok) throw new HttpError(502, "The video service refused to start playback", "VIDEO_SERVICE_ERROR");
  const b = (await res.json()) as { sessionId: string; expiresAt: string; manifestUrl: string; thumbnailsUrl?: string; posterUrl?: string; watermark?: { required?: boolean; text?: string } };
  return {
    sessionId: b.sessionId,
    expiresAt: b.expiresAt,
    manifestUrl: b.manifestUrl,
    thumbnailsUrl: b.thumbnailsUrl ?? null,
    posterUrl: b.posterUrl ?? null,
    watermark: b.watermark?.required ? { required: true, text: b.watermark.text ?? viewerId } : null,
  };
}

export function evsCanList(): boolean {
  return !!config.EVS_BASE_URL && isRealKey(config.EVS_READ_KEY);
}

export async function listVideos(q: { q?: string; page?: number; limit?: number }): Promise<{ items: EvsVideoRow[]; page: number; total: number }> {
  if (!evsCanList()) throw new HttpError(503, "The video library is not connected (set EVS_READ_KEY)", "VIDEO_LIBRARY_NOT_CONFIGURED");
  const params = new URLSearchParams();
  if (q.q) params.set("q", q.q);
  params.set("page", String(q.page ?? 1));
  params.set("limit", String(Math.min(50, q.limit ?? 20)));
  const res = await call(`/v1/videos?${params.toString()}`, config.EVS_READ_KEY as string);
  if (!res.ok) throw new HttpError(502, "The video service did not answer", "VIDEO_SERVICE_ERROR");
  const b = (await res.json()) as { data?: { id: string; title: string; status: string; durationSeconds: number | null; posterUrl: string | null; createdAt: string }[]; pagination?: { page: number; total: number } };
  return {
    items: (b.data ?? []).map((v) => ({ id: v.id, title: v.title, status: v.status, durationSeconds: v.durationSeconds ?? null, posterUrl: v.posterUrl ?? null, createdAt: v.createdAt })),
    page: b.pagination?.page ?? 1,
    total: b.pagination?.total ?? 0,
  };
}

/** Null when the signature is valid, else why not. */
export function verifyWebhook(rawBody: Buffer, header: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  if (!header) return "missing EVS-Signature";
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return "malformed EVS-Signature";
  if (Math.abs(nowSeconds - t) > WEBHOOK_TOLERANCE_SECONDS) return "timestamp outside tolerance";
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.`).update(rawBody).digest("hex"));
  const provided = Buffer.from(parts.v1);
  return expected.length === provided.length && timingSafeEqual(expected, provided) ? null : "signature mismatch";
}

/** Sign like EVS does (tests and the local stub). */
export function signWebhook(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

export interface EvsEvent {
  id: string;
  type: string;
  createdAt: string;
  data: { videoId?: string; durationSeconds?: number | null; error?: string };
}
