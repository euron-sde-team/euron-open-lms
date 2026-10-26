/**
 * Uploads: the browser asks for a presigned PUT, uploads straight to storage, then calls
 * complete. Nothing the client says about the file is trusted past the first step: on
 * complete we HEAD the stored object (size must equal what was declared) and sniff its
 * first bytes (must match the declared type). Images are then re-encoded by the
 * media.process job, which strips EXIF and GPS and writes a thumbnail; until it has
 * (status READY) an image is shown to nobody but its uploader. HEIC the server cannot
 * decode is rejected rather than served with its metadata.
 *
 * Reading an upload (GET /media/:id) requires being able to see whatever it is attached
 * to; an unattached upload is visible only to its owner. Lecture PDFs and resources need
 * access to their course (services/access.service.ts); a submission file is visible to
 * its learner, the course's staff and platform staff only.
 */
import type { Media, UploadPurpose } from "@open-lms/types";
import sharp from "sharp";
import { type Actor, isStaff, requireActive } from "../core/context";
import { withEffects } from "../core/effects";
import { badRequest, conflict, HttpError, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { captureError, logger } from "../core/logger";
import { db, type Executor } from "../db/kysely";
import { checkDeclared, cleanFileName, isoBmffDuration, kindLimit, sniffMatches, storageKeyFor, wavDuration } from "../domain/media-rules";
import { storage, type PresignedPut } from "../integrations/storage";
import { consume } from "../middleware/rate-limit";
import { isPresentable, toMedia } from "../presenters/media.presenter";
import { mediaRepo, type MediaRow } from "../repositories/media.repository";
import { decide, findCourse, staffRoleOn } from "./access.service";

const SNIFF_BYTES = 4096;
export const HEIC_UNSUPPORTED = "HEIC photos cannot be processed on this server; export the photo as JPEG and upload it again";
const THUMB_WIDTH = 640;
/** Durations are parsed in memory; past this size we skip it rather than buffer the file. */
const DURATION_PARSE_MAX_BYTES = 100 * 1024 * 1024;

export interface CreateUploadInput {
  purpose: UploadPurpose;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export async function createUpload(actor: Actor, input: CreateUploadInput): Promise<{ uploadId: string; put: PresignedPut }> {
  requireActive(actor);
  const check = checkDeclared(input);
  if (!check.ok) {
    throw check.code === "MEDIA_TOO_LARGE" ? new HttpError(413, check.message, check.code, check.details) : badRequest(check.message, check.code, check.details);
  }
  await consume("media-upload", `u:${actor.id}`, 120, 3600);
  const id = newId();
  const key = storageKeyFor(input.purpose, id, check.ext);
  await mediaRepo.insert({
    id,
    owner_id: actor.id,
    purpose: input.purpose,
    kind: check.kind,
    mime_type: check.mimeType,
    file_name: cleanFileName(input.fileName),
    declared_size: input.sizeBytes,
    storage_key: key,
  });
  const put = await storage().presignPut(key, check.mimeType, input.sizeBytes);
  return { uploadId: id, put };
}

async function ownUpload(actor: Actor, id: string, exec: Executor = db): Promise<MediaRow> {
  const row = await mediaRepo.findById(id, exec);
  if (!row || row.owner_id !== actor.id || row.status === "DELETED") throw notFound("Upload not found", "UPLOAD_NOT_FOUND");
  return row;
}

async function reject(row: MediaRow, reason: string): Promise<void> {
  await mediaRepo.update(row.id, { status: "REJECTED", rejected_reason: reason.slice(0, 200) });
  await storage()
    .delete(row.storage_key)
    .catch((err) => captureError(err, { where: "media.reject.delete", uploadId: row.id }));
}

/** Verify what landed in storage, then hand the upload to the processing job. */
export async function completeUpload(actor: Actor, id: string): Promise<Media> {
  requireActive(actor);
  const row = await ownUpload(actor, id);
  if (row.status === "COMPLETE" || row.status === "READY") return toMedia(row);
  if (row.status === "REJECTED") throw badRequest("This upload was rejected", "MEDIA_REJECTED", { reason: row.rejected_reason });

  const store = storage();
  const head = await store.head(row.storage_key);
  if (!head) throw badRequest("The file has not been uploaded yet", "UPLOAD_MISSING");

  const declared = Number(row.declared_size);
  if (head.sizeBytes !== declared || head.sizeBytes > kindLimit(row.kind)) {
    await reject(row, "size mismatch");
    throw badRequest("The uploaded file does not match the declared size", "MEDIA_SIZE_MISMATCH");
  }
  const start = await store.readStart(row.storage_key, SNIFF_BYTES);
  if (!sniffMatches(row.mime_type, start)) {
    await reject(row, "content does not match type");
    throw badRequest("The file content does not match its type", "MEDIA_TYPE_MISMATCH");
  }

  const done = await withEffects(async (fx) => {
    const updated = await mediaRepo.transition(row.id, ["PENDING"], { status: "COMPLETE", size_bytes: head.sizeBytes, completed_at: new Date() });
    if (updated) fx.job("media.process", { uploadId: row.id });
    return updated;
  });
  // Inline jobs (tests, tiny installs) may have moved it to READY already.
  const fresh = (await mediaRepo.findById(row.id)) ?? done ?? row;
  return toMedia(fresh);
}

export async function deleteUpload(actor: Actor, id: string): Promise<void> {
  requireActive(actor);
  const row = await ownUpload(actor, id);
  if (await mediaRepo.isAttached(row.id)) throw conflict("This file is attached to something; remove it there first", "MEDIA_IN_USE");
  await mediaRepo.update(row.id, { status: "DELETED" });
  const store = storage();
  for (const key of [row.storage_key, row.thumb_key]) {
    if (key) await store.delete(key).catch((err) => captureError(err, { where: "media.delete", uploadId: row.id }));
  }
}

/** True when the viewer can see something this upload is attached to. */
async function canSeeParent(viewer: Actor | null, row: MediaRow, exec: Executor = db): Promise<boolean> {
  const courseOpen = async (courseId: string, previewItemId?: string) => {
    const course = await findCourse({ id: courseId }, exec);
    if (!course) return false;
    if ((await decide(viewer, course, exec)).decision.granted) return true;
    if (!previewItemId || course.status !== "PUBLISHED") return false;
    const item = await exec.selectFrom("course_items").select("is_preview").where("id", "=", previewItemId).executeTakeFirst();
    return !!item?.is_preview;
  };
  switch (row.purpose) {
    case "AVATAR": {
      const person = await exec.selectFrom("users").select("id").where("avatar_upload_id", "=", row.id).where("status", "in", ["ACTIVE", "SUSPENDED"]).executeTakeFirst();
      return !!person;
    }
    case "BRANDING":
      return true;
    case "COURSE_COVER": {
      const course = await exec.selectFrom("courses").select("status").where("cover_upload_id", "=", row.id).executeTakeFirst();
      if (course?.status === "PUBLISHED") return true;
      const bundle = await exec.selectFrom("bundles").select("status").where("cover_upload_id", "=", row.id).executeTakeFirst();
      return bundle?.status === "ACTIVE";
    }
    case "LECTURE_PDF": {
      const lecture = await exec.selectFrom("lectures as l").innerJoin("course_items as i", "i.id", "l.item_id").select(["i.id", "i.course_id"]).where("l.pdf_upload_id", "=", row.id).executeTakeFirst();
      return !!lecture && (await courseOpen(lecture.course_id, lecture.id));
    }
    case "LECTURE_RESOURCE": {
      const res = await exec.selectFrom("lecture_resources as r").innerJoin("course_items as i", "i.id", "r.item_id").select(["i.id", "i.course_id"]).where("r.upload_id", "=", row.id).executeTakeFirst();
      return !!res && (await courseOpen(res.course_id, res.id));
    }
    case "SUBMISSION": {
      if (!viewer) return false;
      const sub = await exec.selectFrom("submission_files as f").innerJoin("assignment_submissions as s", "s.id", "f.submission_id").select(["s.course_id", "s.user_id"]).where("f.upload_id", "=", row.id).executeTakeFirst();
      return !!sub && (sub.user_id === viewer.id || !!(await staffRoleOn(viewer.id, sub.course_id, exec)));
    }
    default:
      return false;
  }
}

export async function getMedia(viewer: Actor | null, id: string): Promise<Media> {
  const row = await mediaRepo.findById(id);
  if (!row || (row.status !== "COMPLETE" && row.status !== "READY")) throw notFound("Media not found");
  const owner = viewer?.id === row.owner_id;
  // The uploader may see their own unprocessed image; nobody else sees one before its metadata is stripped.
  if (!owner && !isPresentable(row)) throw notFound("Media not found");
  if (!owner && !isStaff(viewer) && !(await canSeeParent(viewer, row))) throw notFound("Media not found");
  return toMedia(row);
}

// ─── Processing job ─────────────────────────────────────────────────────────

/**
 * media.process: images are re-encoded (auto-rotated, EXIF and GPS dropped, since sharp
 * writes no metadata unless asked) and get a 640px WebP thumbnail; video and audio get a
 * duration when the container is one we can parse cheaply. Then READY.
 */
export async function processUpload(uploadId: string): Promise<void> {
  const row = await mediaRepo.findById(uploadId);
  if (!row || row.status !== "COMPLETE") return;
  const store = storage();

  if (row.kind === "IMAGE") {
    const original = await store.get(row.storage_key);
    let processed: { data: Buffer; width: number; height: number } | null = null;
    try {
      processed = await reencodeImage(original, row.mime_type);
    } catch (err) {
      if (row.mime_type === "image/heic" || row.mime_type === "image/heif") {
        // The bundled libvips usually has no HEVC decoder. Serving the original would
        // publish its EXIF (GPS included), so the upload is refused with a reason the
        // web app can show instead.
        logger.warn({ uploadId }, "HEIC image could not be decoded; rejected");
        await reject(row, HEIC_UNSUPPORTED);
        return;
      }
      captureError(err, { where: "media.process", uploadId });
      await reject(row, "image could not be decoded");
      return;
    }
    await store.put(row.storage_key, processed.data, row.mime_type);
    const thumbKey = `${row.storage_key}.thumb.webp`;
    const thumb = await sharp(processed.data, { animated: false }).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    await store.put(thumbKey, thumb, "image/webp");
    await mediaRepo.transition(row.id, ["COMPLETE"], {
      status: "READY",
      width: processed.width,
      height: processed.height,
      size_bytes: processed.data.length,
      thumb_key: thumbKey,
    });
    return;
  }

  let duration: number | null = null;
  if ((row.kind === "VIDEO" || row.kind === "AUDIO") && Number(row.size_bytes ?? 0) <= DURATION_PARSE_MAX_BYTES) {
    try {
      const buf = await store.get(row.storage_key);
      duration = row.mime_type.includes("wav") ? wavDuration(buf) : isoBmffDuration(buf);
    } catch (err) {
      captureError(err, { where: "media.duration", uploadId });
    }
  }
  await mediaRepo.transition(row.id, ["COMPLETE"], { status: "READY", duration_seconds: duration });
}

async function reencodeImage(input: Buffer, mime: string): Promise<{ data: Buffer; width: number; height: number }> {
  const animated = mime === "image/gif" || mime === "image/webp";
  let pipeline = sharp(input, { animated, failOn: "error" }).rotate();
  if (mime === "image/jpeg") pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
  else if (mime === "image/png") pipeline = pipeline.png();
  else if (mime === "image/webp") pipeline = pipeline.webp({ quality: 88 });
  else if (mime === "image/gif") pipeline = pipeline.gif();
  else pipeline = pipeline.jpeg({ quality: 88 });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const height = info.pageHeight ?? info.height;
  return { data, width: info.width, height };
}

/** maintenance.expire-uploads: abandoned, rejected and never-attached uploads. */
export async function expireUploads(batch = 500): Promise<number> {
  const store = storage();
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const rows = await mediaRepo.findExpired(batch);
    if (!rows.length) break;
    const deleted = new Set(await mediaRepo.deleteUnreferenced(rows.map((r) => r.id)));
    for (const r of rows) {
      if (!deleted.has(r.id)) continue;
      for (const key of [r.storage_key, r.thumb_key]) {
        if (key) await store.delete(key).catch((err) => captureError(err, { where: "media.expire", uploadId: r.id }));
      }
    }
    total += deleted.size;
    if (rows.length < batch) break;
  }
  return total;
}
