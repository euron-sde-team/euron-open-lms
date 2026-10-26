/**
 * Offline downloads for the mobile app. A download is a licence to keep one video lecture
 * on one device, issued through the same access check as playback, and only ever as long
 * as that access lasts:
 *
 *   start     POST /api/learn/items/:itemId/downloads { deviceId }
 *             requireItemAccess (an enrollment, a plan, course staff; a free preview is
 *             not enough), then: offline downloads on (settings.learning.offline), the
 *             course allows them (courses.allow_downloads), the item is a READY video that
 *             is not on YouTube, and the learner holds fewer than maxPerUser active
 *             licences. EVS videos get the longest playback session EVS grants to fetch
 *             the stream in; HLS and MP4 return their URL. The licence (re)starts a window
 *             of `days`.
 *   validate  POST /api/my/downloads/validate { deviceId, itemIds }
 *             while online the app asks which copies may keep playing: valid ones slide
 *             their window forward, the rest are revoked (access ended or was refunded,
 *             downloads were switched off, the item stopped being a downloadable video,
 *             an admin revoked the licence, or the app never had one).
 *   remove    DELETE /api/my/downloads/:itemId?deviceId=  the learner deleted the copy.
 *
 * The cap is counted under the learner's row lock, so two parallel starts cannot both
 * take the last slot. Admins list and revoke licences from the learner's page
 * (admin-learners.service.ts).
 */
import type { OfflineDownload, OfflineValidation } from "@open-lms/types";
import { config } from "../core/config";
import type { Actor } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, forbidden } from "../core/errors";
import { newId } from "../core/ids";
import { EVS_MAX_TTL_SECONDS, mintPlayback } from "../integrations/evs";
import { classroomRepo } from "../repositories/classroom.repository";
import { offlineDownloadRepo } from "../repositories/offline-download.repository";
import { decide, findCourse, requireItemAccess } from "./access.service";
import { getSettings } from "./settings.service";

const DAY_MS = 86_400_000;

export async function startDownload(actor: Actor, itemId: string, deviceId: string): Promise<OfflineDownload> {
  const { offline } = (await getSettings()).learning;
  if (!offline.enabled) throw conflict("Offline downloads are switched off for this academy", "OFFLINE_DISABLED");
  const granted = await requireItemAccess(actor, itemId);
  if (granted.preview) throw forbidden("Enroll to download this lesson", "COURSE_ACCESS_REQUIRED", { reason: "PREVIEW_ONLY", courseSlug: granted.course.slug });
  const course = await classroomRepo.courseFlags(granted.course.id);
  if (!course?.allow_downloads) throw conflict("This course's videos cannot be downloaded", "DOWNLOADS_NOT_ALLOWED");
  const lecture = granted.item.kind === "LECTURE" ? await classroomRepo.lecture(itemId) : undefined;
  if (!lecture || lecture.lecture_kind !== "VIDEO" || !lecture.video_provider || !lecture.video_ref) throw conflict("This item is not a video", "NOT_A_VIDEO");
  if (lecture.video_provider === "YOUTUBE") throw conflict("YouTube videos cannot be downloaded", "DOWNLOAD_NOT_SUPPORTED");
  if (lecture.video_status !== "READY") throw conflict("This video is still processing", "VIDEO_NOT_READY");

  // The stream first (a network call, kept out of the transaction), then the licence.
  const source =
    lecture.video_provider === "EVS"
      ? await mintPlayback(lecture.video_ref, actor.id, new URL(config.APP_WEB_URL).origin, { ttlSeconds: EVS_MAX_TTL_SECONDS }).then((s) => ({ provider: "EVS" as const, manifestUrl: s.manifestUrl, expiresAt: s.expiresAt, watermark: s.watermark?.text ?? null }))
      : { provider: lecture.video_provider, url: lecture.video_ref, expiresAt: null, watermark: (await classroomRepo.viewerEmail(actor.id))?.email ?? null };

  const expiresAt = new Date(Date.now() + offline.days * DAY_MS);
  const row = await withTransaction(async (trx) => {
    await trx.selectFrom("users").select("id").where("id", "=", actor.id).forUpdate().executeTakeFirst();
    const active = await offlineDownloadRepo.countActiveExcept(actor.id, itemId, deviceId, trx);
    if (active >= offline.maxPerUser) throw conflict(`You can keep at most ${offline.maxPerUser} downloads; remove one first`, "DOWNLOAD_LIMIT_REACHED", { limit: offline.maxPerUser });
    return offlineDownloadRepo.upsert({ id: newId(), user_id: actor.id, item_id: itemId, course_id: granted.course.id, device_id: deviceId, expires_at: expiresAt }, trx);
  });

  const base = { itemId, courseId: granted.course.id, courseSlug: granted.course.slug, title: granted.item.title, durationSeconds: granted.item.duration_seconds, offlineExpiresAt: row.expires_at.toISOString() };
  return source.provider === "EVS"
    ? { ...base, provider: "EVS", manifestUrl: source.manifestUrl, expiresAt: source.expiresAt, watermark: source.watermark }
    : { ...base, provider: source.provider, url: source.url, expiresAt: null, watermark: source.watermark };
}

export async function validateDownloads(actor: Actor, deviceId: string, itemIdsIn: string[]): Promise<OfflineValidation> {
  const itemIds = [...new Set(itemIdsIn)];
  const { offline } = (await getSettings()).learning;
  const rows = await offlineDownloadRepo.forDevice(actor.id, deviceId, itemIds);

  // One access decision per course, exactly as playback would decide it now.
  const courseOk = new Map<string, boolean>();
  if (offline.enabled) {
    for (const courseId of new Set(rows.map((r) => r.course_id))) {
      const course = await findCourse({ id: courseId });
      courseOk.set(courseId, !!course && (await decide(actor, course)).decision.granted);
    }
  }
  const keep = rows.filter((r) => offline.enabled && !r.revoked_at && r.allow_downloads && r.lecture_kind === "VIDEO" && r.video_provider !== "YOUTUBE" && courseOk.get(r.course_id));
  const keepIds = new Set(keep.map((r) => r.id));
  const expiresAt = new Date(Date.now() + offline.days * DAY_MS);
  await withTransaction(async (trx) => {
    await offlineDownloadRepo.extend([...keepIds], expiresAt, trx);
    await offlineDownloadRepo.revoke(rows.filter((r) => !keepIds.has(r.id) && !r.revoked_at).map((r) => r.id), trx);
  });
  const validItems = new Set(keep.map((r) => r.item_id));
  return {
    valid: keep.map((r) => ({ itemId: r.item_id, offlineExpiresAt: expiresAt.toISOString() })),
    revoked: itemIds.filter((id) => !validItems.has(id)),
  };
}

export async function removeDownload(actor: Actor, itemId: string, deviceId: string): Promise<void> {
  await offlineDownloadRepo.deleteOwn(actor.id, itemId, deviceId);
}
