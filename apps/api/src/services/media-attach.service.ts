/**
 * The only way content gets media: by upload id. Raw URLs and storage keys from the
 * client are never accepted (the source system stored whatever fileUrl/s3Key a client
 * sent, so anyone could attach someone else's file or an arbitrary link).
 *
 * An upload can be attached if the caller owns it, it finished uploading (COMPLETE or
 * READY), its purpose matches, and it is not already attached to something else.
 */
import type { UploadPurpose } from "@open-lms/types";
import { badRequest } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import type { MediaRow } from "../repositories/media.repository";

const ATTACHED_IN: { table: "submission_files"; purpose: UploadPurpose }[] = [{ table: "submission_files", purpose: "SUBMISSION" }];

/**
 * Validate and lock the uploads (FOR UPDATE, inside the caller's transaction) and return
 * them in the order given. Throws 400 MEDIA_INVALID when any id fails the rules.
 */
export async function claimUploads(ownerId: string, uploadIds: readonly string[], purpose: UploadPurpose, exec: Executor = db): Promise<MediaRow[]> {
  const ids = [...new Set(uploadIds)];
  if (!ids.length) return [];
  const rows = await exec.selectFrom("media_uploads").selectAll().where("id", "in", ids).forUpdate().execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || row.owner_id !== ownerId) throw badRequest("One of the attachments was not found", "MEDIA_INVALID");
    if (row.purpose !== purpose) throw badRequest("That attachment was uploaded for something else", "MEDIA_INVALID");
    if (row.status !== "COMPLETE" && row.status !== "READY") throw badRequest("An attachment has not finished uploading", "MEDIA_NOT_READY");
  }
  for (const { table, purpose: p } of ATTACHED_IN) {
    if (p !== purpose) continue;
    const used = await exec.selectFrom(table).select("upload_id").where("upload_id", "in", ids).executeTakeFirst();
    if (used) throw badRequest("An attachment is already used elsewhere", "MEDIA_IN_USE");
  }
  return ids.map((id) => byId.get(id) as MediaRow);
}

/**
 * Single upload for avatars, covers, branding, lecture PDFs and resources
 * (purpose-checked and owner-checked).
 */
export async function claimSingle(ownerId: string, uploadId: string | null | undefined, purpose: UploadPurpose, exec: Executor = db): Promise<string | null> {
  if (!uploadId) return null;
  const row = await exec.selectFrom("media_uploads").selectAll().where("id", "=", uploadId).executeTakeFirst();
  if (!row || row.owner_id !== ownerId || row.purpose !== purpose) throw badRequest("File not found", "MEDIA_INVALID");
  if (row.status !== "COMPLETE" && row.status !== "READY") throw badRequest("The file has not finished uploading", "MEDIA_NOT_READY");
  const imageOnly: UploadPurpose[] = ["AVATAR", "COURSE_COVER", "BRANDING"];
  if (imageOnly.includes(purpose) && row.kind !== "IMAGE") throw badRequest("Choose an image file", "MEDIA_INVALID");
  return row.id;
}
