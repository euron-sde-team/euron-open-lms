/**
 * How to play one video lecture, right now. Called after the entitlement check
 * (requireItemAccess: an enrollment, staff, or a free preview), never before.
 *
 *   EVS      a playback session minted server-side (integrations/evs.ts) for this viewer
 *            (the learner's id, or "preview-anon" for signed-out previews) and the web
 *            app's origin. The EVS key never reaches the browser.
 *   HLS/MP4  the stored URL; watermarked with the learner's email when signed in.
 *   YOUTUBE  a youtube-nocookie embed.
 *
 * The video reference itself is only ever revealed here, in the form the player needs.
 */
import type { Playback } from "@open-lms/types";
import { config } from "../core/config";
import type { Actor } from "../core/context";
import { conflict, notFound } from "../core/errors";
import { youtubeId } from "../domain/safe-url";
import { mintPlayback } from "../integrations/evs";
import { classroomRepo } from "../repositories/classroom.repository";
import { requireItemAccess } from "./access.service";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export async function playback(viewer: Actor | null, itemId: string): Promise<Playback> {
  const granted = await requireItemAccess(viewer, itemId);
  const lecture = granted.item.kind === "LECTURE" ? await classroomRepo.lecture(itemId) : undefined;
  if (!lecture || lecture.lecture_kind !== "VIDEO" || !lecture.video_provider || !lecture.video_ref) throw conflict("This item is not a video", "NOT_A_VIDEO");
  if (lecture.video_status !== "READY") throw conflict("This video is still processing", "VIDEO_NOT_READY");

  const signedIn = viewer && !granted.preview ? viewer : null;
  const resumeAt = signedIn && granted.enrollmentId ? ((await classroomRepo.progressForItem(signedIn.id, itemId))?.position_seconds ?? 0) : 0;

  switch (lecture.video_provider) {
    case "EVS": {
      const session = await mintPlayback(lecture.video_ref, viewer?.id ?? "preview-anon", new URL(config.APP_WEB_URL).origin);
      return { provider: "EVS", manifestUrl: session.manifestUrl, thumbnailsUrl: session.thumbnailsUrl, posterUrl: session.posterUrl, watermark: session.watermark?.text ?? null, expiresAt: session.expiresAt, resumeAt };
    }
    case "HLS":
    case "MP4": {
      const email = signedIn ? ((await classroomRepo.viewerEmail(signedIn.id))?.email ?? null) : null;
      return { provider: lecture.video_provider, url: lecture.video_ref, posterUrl: null, watermark: email, resumeAt, expiresAt: null };
    }
    case "YOUTUBE": {
      const id = YOUTUBE_ID.test(lecture.video_ref) ? lecture.video_ref : youtubeId(lecture.video_ref);
      if (!id) throw notFound("This video is not available", "VIDEO_NOT_FOUND");
      return { provider: "YOUTUBE", embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0`, resumeAt, watermark: null, expiresAt: null };
    }
  }
}
