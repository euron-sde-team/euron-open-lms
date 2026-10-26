/**
 * Media endpoints. The local-storage pair (PUT/GET /local/:token) stands in for S3
 * presigned URLs in development: the signed token is the only authority, exactly like a
 * presigned URL, so these two routes take no bearer token.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { forbidden, HttpError, notFound } from "../core/errors";
import { idParam, parse } from "../core/validate";
import { storage, verifyLocal } from "../integrations/storage";
import { actorOf } from "../middleware/http";
import * as media from "../services/media.service";

const PURPOSES = ["AVATAR", "COURSE_COVER", "LECTURE_PDF", "LECTURE_RESOURCE", "SUBMISSION", "BRANDING"] as const;

const createBody = z.object({
  purpose: z.enum(PURPOSES),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(150),
  sizeBytes: z.number().int().positive(),
}).strict();

export async function createUpload(req: Request, res: Response) {
  res.status(201).json(await media.createUpload(actorOf(req), parse(createBody, req.body)));
}

export async function completeUpload(req: Request, res: Response) {
  const { id } = parse(idParam, req.params);
  res.json(await media.completeUpload(actorOf(req), id));
}

export async function deleteUpload(req: Request, res: Response) {
  const { id } = parse(idParam, req.params);
  await media.deleteUpload(actorOf(req), id);
  res.status(204).end();
}

export async function getMedia(req: Request, res: Response) {
  const { id } = parse(idParam, req.params);
  res.json(await media.getMedia(req.actor ?? null, id));
}

function localOnly(): void {
  if (storage().mode !== "local") throw notFound();
}

/** Read the raw request body, refusing to buffer more than `max` bytes. */
function readBody(req: Request, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new HttpError(413, "The upload is larger than declared", "MEDIA_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function localPut(req: Request, res: Response) {
  localOnly();
  const grant = verifyLocal(String(req.params.token ?? ""), "put");
  if (!grant) throw forbidden("Upload link is invalid or expired", "UPLOAD_LINK_INVALID");
  const sep = grant.extra.lastIndexOf(";");
  const signedType = grant.extra.slice(0, sep);
  const signedSize = Number(grant.extra.slice(sep + 1));
  // The same two headers an S3 presigned PUT signs: the type and the exact length.
  const sentType = (req.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (sentType !== signedType) throw forbidden("Content-Type does not match the upload link", "UPLOAD_LINK_MISMATCH");
  const declaredLength = req.get("content-length");
  if (declaredLength !== undefined && Number(declaredLength) !== signedSize) throw forbidden("Content-Length does not match the upload link", "UPLOAD_LINK_MISMATCH");
  const body = await readBody(req, signedSize);
  if (body.length !== signedSize) throw forbidden("Content-Length does not match the upload link", "UPLOAD_LINK_MISMATCH");
  await storage().put(grant.key, body, signedType);
  res.status(204).end();
}

export async function localGet(req: Request, res: Response) {
  localOnly();
  const grant = verifyLocal(String(req.params.token ?? ""), "get");
  if (!grant) throw forbidden("Link is invalid or expired", "MEDIA_LINK_INVALID");
  const store = storage();
  const head = await store.head(grant.key);
  if (!head) throw notFound();
  const type = head.contentType ?? "application/octet-stream";
  const inline = type.startsWith("image/") || type.startsWith("video/");
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", String(head.sizeBytes));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", inline ? "inline" : `attachment; filename="${grant.key.split("/").pop()}"`);
  res.end(await store.get(grant.key));
}
