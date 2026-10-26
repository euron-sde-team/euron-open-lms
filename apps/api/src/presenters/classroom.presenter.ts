/**
 * Classroom DTOs: item progress and lecture resources. Quiz and assignment DTOs come
 * from the assessments presenters.
 */
import type { ItemProgress, LectureResource } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { watchedPercent } from "../domain/progress";
import { safeUrl } from "../domain/safe-url";
import type { ProgressRow } from "../repositories/classroom.repository";
import { loadMedia } from "./media.presenter";

export const EMPTY_PROGRESS: ItemProgress = { completed: false, completedAt: null, positionSeconds: 0, watchedPercent: 0 };

export function toItemProgress(row: ProgressRow | undefined, durationSeconds: number): ItemProgress {
  if (!row) return EMPTY_PROGRESS;
  return {
    completed: !!row.completed_at,
    completedAt: row.completed_at?.toISOString() ?? null,
    positionSeconds: row.position_seconds,
    watchedPercent: row.completed_at && durationSeconds <= 0 ? 100 : watchedPercent({ watchedSeconds: row.watched_seconds }, durationSeconds),
  };
}

/** Resources with signed download URLs (uploads) or the external link. Unusable rows are left out. */
export async function presentResources(rows: { id: string; title: string; upload_id: string | null; url: string | null }[], exec: Executor = db): Promise<LectureResource[]> {
  const media = await loadMedia(rows.map((r) => r.upload_id), exec);
  const out: LectureResource[] = [];
  for (const r of rows) {
    if (r.upload_id) {
      const m = media.get(r.upload_id);
      if (m) out.push({ id: r.id, title: r.title, url: m.url, external: false, fileName: m.fileName, sizeBytes: m.sizeBytes });
    } else {
      const url = safeUrl(r.url);
      if (url) out.push({ id: r.id, title: r.title, url, external: true, fileName: null, sizeBytes: null });
    }
  }
  return out;
}
