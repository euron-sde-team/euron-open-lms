/**
 * Uploads. Besides plain CRUD this knows every table that can reference an upload, so
 * "is it attached?" (delete, expiry) has one definition.
 */
import { sql, type Insertable, type Selectable, type Updateable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { MediaUploads } from "../db/types";

export type MediaRow = Selectable<MediaUploads>;

/** Every column that can point at an upload. */
const REFERENCES = sql`
  EXISTS (SELECT 1 FROM users r WHERE r.avatar_upload_id = mu.id)
  OR EXISTS (SELECT 1 FROM courses r WHERE r.cover_upload_id = mu.id)
  OR EXISTS (SELECT 1 FROM bundles r WHERE r.cover_upload_id = mu.id)
  OR EXISTS (SELECT 1 FROM lectures r WHERE r.pdf_upload_id = mu.id)
  OR EXISTS (SELECT 1 FROM lecture_resources r WHERE r.upload_id = mu.id)
  OR EXISTS (SELECT 1 FROM submission_files r WHERE r.upload_id = mu.id)
  OR EXISTS (SELECT 1 FROM settings r WHERE r.key = 'academy' AND r.value ->> 'logoUploadId' = mu.id)`;

export class MediaRepository {
  findById(id: string, exec: Executor = db) {
    return exec.selectFrom("media_uploads").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findMany(ids: readonly string[], exec: Executor = db): Promise<MediaRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return exec.selectFrom("media_uploads").selectAll().where("id", "in", [...new Set(ids)]).execute();
  }

  insert(row: Insertable<MediaUploads>, exec: Executor = db) {
    return exec.insertInto("media_uploads").values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, patch: Updateable<MediaUploads>, exec: Executor = db) {
    return exec.updateTable("media_uploads").set(patch).where("id", "=", id).returningAll().executeTakeFirst();
  }

  /** Move a row from one status to another only if it is still in the expected one (job retries). */
  transition(id: string, from: MediaRow["status"][], patch: Updateable<MediaUploads>, exec: Executor = db) {
    return exec.updateTable("media_uploads").set(patch).where("id", "=", id).where("status", "in", from).returningAll().executeTakeFirst();
  }

  async isAttached(id: string, exec: Executor = db): Promise<boolean> {
    const row = await sql<{ attached: boolean }>`SELECT (${REFERENCES}) AS attached FROM media_uploads mu WHERE mu.id = ${id}`.execute(exec);
    return !!row.rows[0]?.attached;
  }

  /**
   * Uploads the expiry job may delete: PENDING older than 24h, any REJECTED, and finished
   * uploads that nothing references 48h after they were created.
   */
  async findExpired(limit: number, exec: Executor = db): Promise<Pick<MediaRow, "id" | "storage_key" | "thumb_key">[]> {
    const res = await sql<Pick<MediaRow, "id" | "storage_key" | "thumb_key">>`
      SELECT mu.id, mu.storage_key, mu.thumb_key FROM media_uploads mu
      WHERE (mu.status = 'PENDING' AND mu.created_at < now() - interval '24 hours')
         OR mu.status = 'REJECTED'
         OR (mu.status IN ('COMPLETE', 'READY') AND mu.created_at < now() - interval '48 hours' AND NOT (${REFERENCES}))
      ORDER BY mu.created_at
      LIMIT ${limit}`.execute(exec);
    return res.rows;
  }

  /** Delete rows, re-checking that nothing attached them since they were selected. */
  async deleteUnreferenced(ids: string[], exec: Executor = db): Promise<string[]> {
    if (!ids.length) return [];
    const res = await sql<{ id: string }>`
      DELETE FROM media_uploads mu WHERE mu.id = ANY(${ids}::text[]) AND (mu.status IN ('PENDING', 'REJECTED') OR NOT (${REFERENCES}))
      RETURNING mu.id`.execute(exec);
    return res.rows.map((r) => r.id);
  }
}

export const mediaRepo = new MediaRepository();
