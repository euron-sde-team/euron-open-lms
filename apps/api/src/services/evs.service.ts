/**
 * euron-video-system for authors: the video picker, the connection status, looking up
 * a video's state when an author attaches it, and the webhook that flips lecture
 * status when EVS finishes (or fails) processing.
 *
 * The webhook is idempotent by construction: it SETS state (READY or FAILED, and the
 * duration EVS reports) on every EVS lecture with that video id, so a redelivered event
 * writes the same values again. Unknown video ids are a no-op. Course totals are
 * recounted from the items in the same transaction, after taking the course row locks in
 * id order (the same lock the curriculum editor takes first, so the two never deadlock).
 */
import type { EvsVideo, VideoStatus } from "@open-lms/types";
import { requireArea, type Actor } from "../core/context";
import { config, evsEnabled, isRealKey } from "../core/config";
import { withTransaction } from "../core/effects";
import { badRequest, HttpError } from "../core/errors";
import { captureError } from "../core/logger";
import { EVS_VIDEO_ID, evsStatusOf } from "../domain/authoring-rules";
import { evsCanList, listVideos, verifyWebhook, type EvsEvent } from "../integrations/evs";
import { adminCourseRepo } from "../repositories/admin-course.repository";
import { curriculumRepo } from "../repositories/curriculum.repository";

export async function videos(actor: Actor, q: { q?: string; page?: number }): Promise<{ items: EvsVideo[]; page: number; total: number }> {
  requireArea(actor, "courses");
  return listVideos({ q: q.q, page: q.page ?? 1, limit: 20 });
}

export function status(actor: Actor): { configured: boolean; canListVideos: boolean } {
  requireArea(actor, "courses");
  return { configured: evsEnabled(), canListVideos: evsCanList() };
}

/**
 * The state to store when an author attaches an EVS video. With a read key we ask EVS;
 * without one (or when EVS does not answer) the video is assumed playable, and playback
 * itself reports VIDEO_NOT_READY if it is not.
 */
export async function lookupVideo(videoId: string): Promise<{ status: VideoStatus; durationSeconds: number | null }> {
  if (!evsCanList()) return { status: "READY", durationSeconds: null };
  try {
    const found = (await listVideos({ q: videoId, page: 1, limit: 50 })).items.find((v) => v.id === videoId);
    if (!found) return { status: "READY", durationSeconds: null };
    return { status: evsStatusOf(found.status), durationSeconds: found.durationSeconds && found.durationSeconds > 0 ? Math.round(found.durationSeconds) : null };
  } catch (err) {
    captureError(err, { where: "evs.lookupVideo" });
    return { status: "READY", durationSeconds: null };
  }
}

const MAX_DURATION = 360_000;

/** POST /api/webhooks/evs. Throws 400 on a bad signature or body; returns how many lectures changed. */
export async function handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ received: true; updated: number }> {
  const secret = config.EVS_WEBHOOK_SECRET?.trim();
  // The Terraform placeholder "set-me" is public knowledge: never accept it as a signing key.
  if (!secret || !isRealKey(secret)) throw new HttpError(503, "EVS webhooks are not configured on this server", "EVS_WEBHOOK_NOT_CONFIGURED");
  if (!Buffer.isBuffer(rawBody)) throw badRequest("Expected a raw body", "BAD_PAYLOAD");
  const problem = verifyWebhook(rawBody, signature, secret);
  if (problem) throw badRequest(`Invalid signature: ${problem}`, "BAD_SIGNATURE");

  let event: EvsEvent;
  try {
    event = JSON.parse(rawBody.toString("utf8")) as EvsEvent;
  } catch {
    throw badRequest("The body is not JSON", "BAD_PAYLOAD");
  }
  const videoId = event?.data?.videoId;
  const next: VideoStatus | null = event?.type === "video.ready" ? "READY" : event?.type === "video.failed" ? "FAILED" : null;
  if (!next || typeof videoId !== "string" || !EVS_VIDEO_ID.test(videoId)) return { received: true, updated: 0 };
  const raw = Number(event.data.durationSeconds);
  const duration = next === "READY" && Number.isFinite(raw) && raw > 0 ? Math.min(MAX_DURATION, Math.round(raw)) : null;

  return withTransaction(async (trx) => {
    const lectures = await curriculumRepo.evsLectures(videoId, trx);
    if (!lectures.length) return { received: true as const, updated: 0 };
    const courseIds = [...new Set(lectures.map((l) => l.course_id))].sort();
    for (const id of courseIds) await adminCourseRepo.lock(id, trx);
    const itemIds = lectures.map((l) => l.item_id);
    await trx.updateTable("lectures").set({ video_status: next }).where("item_id", "in", itemIds).where("video_provider", "=", "EVS").where("video_ref", "=", videoId).execute();
    if (duration !== null) {
      await trx.updateTable("course_items").set({ duration_seconds: duration, updated_at: new Date() }).where("id", "in", itemIds).execute();
      for (const id of courseIds) await adminCourseRepo.recount(id, trx);
    }
    return { received: true as const, updated: itemIds.length };
  });
}
