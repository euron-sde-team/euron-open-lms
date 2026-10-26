/**
 * What may be uploaded, how big it may be, and whether the bytes are what the client
 * claimed. Pure, so the policy is unit-testable without storage.
 *
 * Three checks, all required:
 *   1. the declared MIME type is on the allowlist (SVG, HTML and anything scriptable
 *      are refused outright: they execute when opened from a signed URL);
 *   2. the file extension belongs to that MIME type (no "invoice.pdf" that is a .exe);
 *   3. the first bytes of the stored object match the type's magic number. This runs
 *      after the upload, on what actually landed in storage, never on client input.
 */
import type { UploadKind, UploadPurpose } from "@open-lms/types";

const MB = 1024 * 1024;

/** Per-kind size limits from the REST contract. */
export const KIND_LIMITS: Record<UploadKind, number> = {
  IMAGE: 15 * MB,
  VIDEO: 200 * MB,
  AUDIO: 50 * MB,
  PDF: 25 * MB,
  DOCUMENT: 25 * MB,
  ARCHIVE: 50 * MB,
  OTHER: 0,
};

type Sniffer = (b: Buffer) => boolean;

interface TypeRule {
  kind: UploadKind;
  exts: string[];
  sniff: Sniffer;
  /** Canonical extension used for the storage key. */
  ext: string;
}

const ascii = (b: Buffer, offset: number, s: string) => b.length >= offset + s.length && b.toString("latin1", offset, offset + s.length) === s;
const bytes = (b: Buffer, offset: number, sig: number[]) => b.length >= offset + sig.length && sig.every((x, i) => b[offset + i] === x);

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

/** ISO base media (MP4, MOV, M4A, HEIC): the `ftyp` box at offset 4 carries a major brand. */
function ftypBrand(b: Buffer): string | null {
  return ascii(b, 4, "ftyp") && b.length >= 12 ? b.toString("latin1", 8, 12) : null;
}

const isJpeg: Sniffer = (b) => bytes(b, 0, [0xff, 0xd8, 0xff]);
const isPng: Sniffer = (b) => bytes(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isGif: Sniffer = (b) => ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a");
const isWebp: Sniffer = (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP");
const isWav: Sniffer = (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE");
const isHeic: Sniffer = (b) => {
  const brand = ftypBrand(b);
  return !!brand && HEIF_BRANDS.has(brand);
};
const isMp4: Sniffer = (b) => {
  const brand = ftypBrand(b);
  return !!brand && !HEIF_BRANDS.has(brand) && brand !== "qt  ";
};
const isQuickTime: Sniffer = (b) => {
  const brand = ftypBrand(b);
  if (brand) return brand === "qt  " || !HEIF_BRANDS.has(brand);
  // Old QuickTime files start with a moov/mdat/wide/free atom instead of ftyp.
  return ["moov", "mdat", "wide", "free", "skip", "pnot"].some((atom) => ascii(b, 4, atom));
};
const isWebm: Sniffer = (b) => bytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3]) && b.subarray(0, 64).includes("webm", 0, "latin1");
const isMp3: Sniffer = (b) => ascii(b, 0, "ID3") || (b.length >= 2 && b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0);
/** Audio-only MP4: the major brand must be an audio one (M4A, M4B audiobook, M4P protected), so a video cannot pass as audio. */
const M4A_BRANDS = new Set(["M4A ", "M4B ", "M4P "]);
const isM4a: Sniffer = (b) => {
  const brand = ftypBrand(b);
  return !!brand && M4A_BRANDS.has(brand);
};
const isOgg: Sniffer = (b) => ascii(b, 0, "OggS");
const isPdf: Sniffer = (b) => ascii(b, 0, "%PDF-");
const isZip: Sniffer = (b) => bytes(b, 0, [0x50, 0x4b, 0x03, 0x04]);

/** Plain text: valid UTF-8, no NUL bytes, and nothing a browser would render as markup. */
const isPlainText: Sniffer = (b) => {
  if (b.includes(0)) return false;
  // Allow a truncated multi-byte sequence at the very end of the sniffed window.
  const text = new TextDecoder("utf-8", { fatal: false }).decode(b);
  const replacements = (text.match(/�/g) ?? []).length;
  if (replacements > 1) return false;
  return !looksLikeMarkup(b);
};

const RULES: Record<string, TypeRule> = {
  "image/jpeg": { kind: "IMAGE", exts: ["jpg", "jpeg"], ext: "jpg", sniff: isJpeg },
  "image/png": { kind: "IMAGE", exts: ["png"], ext: "png", sniff: isPng },
  "image/webp": { kind: "IMAGE", exts: ["webp"], ext: "webp", sniff: isWebp },
  "image/gif": { kind: "IMAGE", exts: ["gif"], ext: "gif", sniff: isGif },
  "image/heic": { kind: "IMAGE", exts: ["heic", "heif"], ext: "heic", sniff: isHeic },
  "image/heif": { kind: "IMAGE", exts: ["heic", "heif"], ext: "heif", sniff: isHeic },
  "video/mp4": { kind: "VIDEO", exts: ["mp4", "m4v"], ext: "mp4", sniff: isMp4 },
  "video/webm": { kind: "VIDEO", exts: ["webm"], ext: "webm", sniff: isWebm },
  "video/quicktime": { kind: "VIDEO", exts: ["mov", "qt"], ext: "mov", sniff: isQuickTime },
  "audio/mpeg": { kind: "AUDIO", exts: ["mp3"], ext: "mp3", sniff: isMp3 },
  "audio/mp4": { kind: "AUDIO", exts: ["m4a"], ext: "m4a", sniff: isM4a },
  "audio/x-m4a": { kind: "AUDIO", exts: ["m4a"], ext: "m4a", sniff: isM4a },
  "audio/ogg": { kind: "AUDIO", exts: ["ogg", "oga", "opus"], ext: "ogg", sniff: isOgg },
  // Chrome and Firefox record voice notes (MediaRecorder) as WebM/Opus.
  "audio/webm": { kind: "AUDIO", exts: ["webm", "weba"], ext: "webm", sniff: isWebm },
  "audio/wav": { kind: "AUDIO", exts: ["wav"], ext: "wav", sniff: isWav },
  "audio/x-wav": { kind: "AUDIO", exts: ["wav"], ext: "wav", sniff: isWav },
  "audio/wave": { kind: "AUDIO", exts: ["wav"], ext: "wav", sniff: isWav },
  "application/pdf": { kind: "PDF", exts: ["pdf"], ext: "pdf", sniff: isPdf },
  "application/zip": { kind: "ARCHIVE", exts: ["zip"], ext: "zip", sniff: isZip },
  "application/x-zip-compressed": { kind: "ARCHIVE", exts: ["zip"], ext: "zip", sniff: isZip },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "DOCUMENT", exts: ["docx"], ext: "docx", sniff: isZip },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "DOCUMENT", exts: ["xlsx"], ext: "xlsx", sniff: isZip },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "DOCUMENT", exts: ["pptx"], ext: "pptx", sniff: isZip },
  "text/csv": { kind: "DOCUMENT", exts: ["csv"], ext: "csv", sniff: isPlainText },
  "text/plain": { kind: "DOCUMENT", exts: ["txt"], ext: "txt", sniff: isPlainText },
};

/** Types refused by name, with a clearer message than "not allowed". */
const DANGEROUS_MIME = /^(image\/svg\+xml|text\/html|application\/xhtml\+xml|text\/xml|application\/xml|text\/javascript|application\/javascript|application\/x-sh)$/i;
const DANGEROUS_EXT = new Set(["svg", "svgz", "html", "htm", "xhtml", "xml", "js", "mjs", "exe", "bat", "cmd", "sh", "php"]);

/**
 * Which kinds each purpose accepts. Avatars, covers and branding are image-only; a PDF
 * lecture is a PDF; downloadable resources and assignment submissions take documents,
 * PDFs, images and zip archives (source code, datasets).
 */
const PURPOSE_KINDS: Record<UploadPurpose, UploadKind[]> = {
  AVATAR: ["IMAGE"],
  COURSE_COVER: ["IMAGE"],
  BRANDING: ["IMAGE"],
  LECTURE_PDF: ["PDF"],
  LECTURE_RESOURCE: ["PDF", "DOCUMENT", "IMAGE", "ARCHIVE", "AUDIO"],
  SUBMISSION: ["PDF", "DOCUMENT", "IMAGE", "ARCHIVE", "AUDIO", "VIDEO"],
};

export const ALLOWED_MIME_TYPES = Object.keys(RULES);

export type DeclaredCheck =
  | { ok: true; kind: UploadKind; ext: string; mimeType: string }
  | { ok: false; code: "MEDIA_TYPE_NOT_ALLOWED" | "MEDIA_EXTENSION_MISMATCH" | "MEDIA_TOO_LARGE" | "MEDIA_PURPOSE_MISMATCH" | "MEDIA_EMPTY"; message: string; details?: Record<string, unknown> };

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Normalise "Image/JPEG; charset=x" to "image/jpeg". */
export function normaliseMime(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

/** Validate what the client declares before we hand out an upload URL. */
export function checkDeclared(input: { purpose: UploadPurpose; fileName: string; mimeType: string; sizeBytes: number }): DeclaredCheck {
  const mimeType = normaliseMime(input.mimeType);
  const ext = extensionOf(input.fileName);
  if (DANGEROUS_MIME.test(mimeType) || DANGEROUS_EXT.has(ext)) {
    return { ok: false, code: "MEDIA_TYPE_NOT_ALLOWED", message: "This file type cannot be uploaded" };
  }
  const rule = RULES[mimeType];
  if (!rule) return { ok: false, code: "MEDIA_TYPE_NOT_ALLOWED", message: "This file type cannot be uploaded", details: { allowed: ALLOWED_MIME_TYPES } };
  if (!rule.exts.includes(ext)) return { ok: false, code: "MEDIA_EXTENSION_MISMATCH", message: "The file extension does not match its type" };
  if (!PURPOSE_KINDS[input.purpose].includes(rule.kind)) {
    return { ok: false, code: "MEDIA_PURPOSE_MISMATCH", message: "This kind of file cannot be used here" };
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, code: "MEDIA_EMPTY", message: "The file is empty" };
  const limit = KIND_LIMITS[rule.kind];
  if (input.sizeBytes > limit) return { ok: false, code: "MEDIA_TOO_LARGE", message: `Files of this kind can be at most ${Math.round(limit / MB)} MB`, details: { maxBytes: limit } };
  return { ok: true, kind: rule.kind, ext: rule.ext, mimeType };
}

/** True when the stored bytes start with the magic number of the declared type. */
export function sniffMatches(mimeType: string, head: Buffer): boolean {
  const rule = RULES[normaliseMime(mimeType)];
  if (!rule || head.length === 0) return false;
  if (rule.kind !== "DOCUMENT" && looksLikeMarkup(head)) return false;
  return rule.sniff(head);
}

/** HTML, SVG or XML that a browser could render (and run scripts in). */
export function looksLikeMarkup(head: Buffer): boolean {
  const start = head
    .subarray(0, 1024)
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  return /^<(\?xml|!doctype|html|head|body|svg|script|iframe|object|embed|meta|link|style)\b/.test(start);
}

export function kindLimit(kind: UploadKind): number {
  return KIND_LIMITS[kind];
}

/** Storage key: media/<purpose>/<yyyy>/<mm>/<id>.<ext>. Nothing from the client file name. */
export function storageKeyFor(purpose: UploadPurpose, id: string, ext: string, now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `media/${purpose.toLowerCase()}/${yyyy}/${mm}/${id}.${ext}`;
}

/** Display name: keep it printable and short; it is only ever shown, never used as a path. */
export function cleanFileName(name: string): string {
  // Control characters are exactly what this strips.
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? "file").replace(/[\u0000-\u001f\u007f"<>]/g, "_").trim();
  return (base || "file").slice(0, 200);
}

// ─── Duration parsing for video and audio (light, no dependencies) ──────────

/** Seconds from an ISO base media file (MP4, MOV, M4A): moov > mvhd timescale and duration. */
export function isoBmffDuration(buf: Buffer): number | null {
  const mvhd = findBox(buf, 0, buf.length, ["moov", "mvhd"]);
  if (!mvhd) return null;
  const version = buf[mvhd.start];
  if (version === 1) {
    if (mvhd.start + 32 > buf.length) return null;
    const timescale = buf.readUInt32BE(mvhd.start + 20);
    const duration = Number(buf.readBigUInt64BE(mvhd.start + 24));
    return timescale ? Math.round(duration / timescale) : null;
  }
  if (mvhd.start + 20 > buf.length) return null;
  const timescale = buf.readUInt32BE(mvhd.start + 12);
  const duration = buf.readUInt32BE(mvhd.start + 16);
  return timescale ? Math.round(duration / timescale) : null;
}

function findBox(buf: Buffer, from: number, to: number, path: string[]): { start: number; end: number } | null {
  let off = from;
  while (off + 8 <= to) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > to) return null;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = to - off;
    }
    if (size < header || off + size > to) return null;
    if (type === path[0]) {
      if (path.length === 1) return { start: off + header, end: off + size };
      return findBox(buf, off + header, off + size, path.slice(1));
    }
    off += size;
  }
  return null;
}

/** Seconds from a PCM WAV header: data chunk size / byte rate. */
export function wavDuration(buf: Buffer): number | null {
  if (!isWav(buf) || buf.length < 36) return null;
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("latin1", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt " && off + 20 <= buf.length) byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") return byteRate ? Math.round(size / byteRate) : null;
    off += 8 + size + (size % 2);
  }
  return null;
}
