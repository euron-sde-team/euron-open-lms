/**
 * Media rows to DTOs. URLs are signed per response and expire; the web app refetches
 * the parent resource rather than caching URLs.
 *
 * Presenters batch: collect every upload id a response needs, call `loadMedia` once,
 * then look each id up in the returned map.
 */
import type { Media } from "@open-lms/types";
import { type Executor, db } from "../db/kysely";
import { storage } from "../integrations/storage";
import { mediaRepo, type MediaRow } from "../repositories/media.repository";

const VISIBLE = new Set(["COMPLETE", "READY"]);

/**
 * Whether an upload may be shown to anyone. Images only once READY: until media.process
 * has re-encoded them, the stored bytes still carry EXIF (GPS position, camera serial).
 * Other kinds are never re-encoded, so COMPLETE is as good as it gets.
 */
export function isPresentable(row: Pick<MediaRow, "kind" | "status">): boolean {
  return row.kind === "IMAGE" ? row.status === "READY" : VISIBLE.has(row.status);
}

export async function toMedia(row: MediaRow): Promise<Media> {
  const store = storage();
  const downloadable = row.kind === "PDF" || row.kind === "DOCUMENT" || row.kind === "OTHER";
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    fileName: row.file_name,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    url: await store.signedGetUrl(row.storage_key, downloadable ? { downloadName: row.file_name } : {}),
    thumbUrl: row.thumb_key ? await store.signedGetUrl(row.thumb_key) : null,
    status: row.status,
  };
}

/** Load and sign uploads by id. Rejected, pending, deleted and not yet processed images are omitted. */
export async function loadMedia(ids: readonly (string | null | undefined)[], exec: Executor = db): Promise<Map<string, Media>> {
  const wanted = ids.filter((x): x is string => !!x);
  const rows = (await mediaRepo.findMany(wanted, exec)).filter(isPresentable);
  const out = new Map<string, Media>();
  for (const row of rows) out.set(row.id, await toMedia(row));
  return out;
}

/** Signed URL for one upload id (avatars, covers), or null. */
export function urlOf(media: Map<string, Media>, id: string | null | undefined, prefer: "thumb" | "full" = "full"): string | null {
  if (!id) return null;
  const m = media.get(id);
  if (!m) return null;
  return prefer === "thumb" ? (m.thumbUrl ?? m.url) : m.url;
}
