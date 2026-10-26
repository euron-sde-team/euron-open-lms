import type { Media, UploadPurpose } from "@open-lms/types";
import { ApiError, networkError } from "./errors";
import type { HttpClient } from "./http";

export interface UploadTicket {
  uploadId: string;
  put: { url: string; method: string; headers: Record<string, string>; expiresAt: string };
}

export interface UploadOptions {
  purpose: UploadPurpose;
  file: Blob & { name?: string };
  /** 0..1 as the bytes go up. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Injected for tests. */
  createXhr?: () => XMLHttpRequest;
}

/** Limits from the contract, per kind, in bytes. */
export const UPLOAD_LIMITS = {
  IMAGE: 15 * 1024 * 1024,
  VIDEO: 200 * 1024 * 1024,
  AUDIO: 50 * 1024 * 1024,
  PDF: 25 * 1024 * 1024,
  DOCUMENT: 25 * 1024 * 1024,
  ARCHIVE: 50 * 1024 * 1024,
} as const;

const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
};

/** The browser's type, or one inferred from the extension (HEIC often arrives untyped). */
export function mimeTypeOf(file: { type?: string; name?: string }): string {
  if (file.type) return file.type;
  const ext = (file.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPES[ext] ?? "application/octet-stream";
}

export type UploadKindGuess = keyof typeof UPLOAD_LIMITS | "OTHER";

export function kindOf(mime: string): UploadKindGuess {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("application/vnd.openxmlformats") || mime === "text/csv" || mime === "text/plain") return "DOCUMENT";
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return "ARCHIVE";
  return "OTHER";
}

/** A friendly client-side check before asking the API (which enforces the same rules). */
export function validateUpload(file: { type?: string; name?: string; size: number }): string | null {
  const mime = mimeTypeOf(file);
  if (mime === "image/svg+xml" || mime === "text/html") return "SVG and HTML files are not allowed.";
  const kind = kindOf(mime);
  if (kind === "OTHER") return "This file type is not supported.";
  const limit = UPLOAD_LIMITS[kind];
  if (file.size > limit) return `This file is too large. The limit is ${Math.round(limit / 1024 / 1024)} MB.`;
  return null;
}

/** PUT bytes with progress, honouring the presigned method and headers. */
export function putWithProgress(
  ticket: UploadTicket["put"],
  file: Blob,
  opts: { onProgress?: (f: number) => void; signal?: AbortSignal; createXhr?: () => XMLHttpRequest } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = opts.createXhr ? opts.createXhr() : new XMLHttpRequest();
    xhr.open(ticket.method || "PUT", ticket.url, true);
    for (const [k, v] of Object.entries(ticket.headers ?? {})) {
      // The browser sets these itself and refuses them from script.
      if (/^(content-length|host)$/i.test(k)) continue;
      xhr.setRequestHeader(k, v);
    }
    if (xhr.upload && opts.onProgress) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) opts.onProgress?.(Math.min(1, e.loaded / e.total));
      };
    }
    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => opts.signal?.removeEventListener("abort", onAbort);
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1);
        resolve();
      } else reject(new ApiError({ status: xhr.status, code: "UPLOAD_FAILED", message: "The upload did not go through. Try again." }));
    };
    xhr.onerror = () => {
      done();
      reject(networkError());
    };
    xhr.onabort = () => {
      done();
      reject(Object.assign(new Error("Upload cancelled"), { name: "AbortError" }));
    };
    xhr.send(file);
  });
}

/** Three steps: ask for a ticket, PUT the bytes, mark complete. Cleans up the ticket on failure. */
export async function uploadMedia(http: HttpClient, opts: UploadOptions): Promise<Media> {
  const mimeType = mimeTypeOf(opts.file);
  const fileName = opts.file.name || "upload";
  const ticket = await http.request<UploadTicket>("POST", "/media/uploads", {
    body: { purpose: opts.purpose, fileName, mimeType, sizeBytes: opts.file.size },
    signal: opts.signal,
  });
  try {
    await putWithProgress(ticket.put, opts.file, { onProgress: opts.onProgress, signal: opts.signal, createXhr: opts.createXhr });
    return await http.request<Media>("POST", `/media/uploads/${encodeURIComponent(ticket.uploadId)}/complete`, { signal: opts.signal });
  } catch (e) {
    void http.request("DELETE", `/media/uploads/${encodeURIComponent(ticket.uploadId)}`).catch(() => undefined);
    throw e;
  }
}
