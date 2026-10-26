/**
 * Object storage for media. Two backends, one interface:
 *
 *   s3     a private bucket (Block Public Access, SSE-KMS). Browsers upload with a
 *          presigned PUT and read through short-lived presigned GETs. Floci locally.
 *   local  files under data/media. The API itself serves the "presigned" URLs, signed
 *          with an HMAC, so the browser flow is identical. Development only.
 *
 * Nothing is ever public: every read URL expires (SIGNED_URL_TTL_SECONDS).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsClientConfig } from "../core/aws";
import { config } from "../core/config";
import { dataDir } from "../core/data-dir";

export interface HeadResult {
  sizeBytes: number;
  contentType: string | null;
}

export interface PresignedPut {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

export interface Storage {
  readonly mode: "local" | "s3";
  presignPut(key: string, contentType: string, sizeBytes: number): Promise<PresignedPut>;
  signedGetUrl(key: string, opts?: { downloadName?: string }): Promise<string>;
  head(key: string): Promise<HeadResult | null>;
  /** The first `bytes` bytes, for magic-number sniffing. */
  readStart(key: string, bytes: number): Promise<Buffer>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// ─── S3 ─────────────────────────────────────────────────────────────────────

class S3Storage implements Storage {
  readonly mode = "s3" as const;
  private readonly client: S3Client;
  /** Presigning uses the browser-reachable endpoint (differs from the in-cluster one locally). */
  private readonly signer: S3Client;
  private readonly bucket: string;

  constructor() {
    if (!config.S3_BUCKET) throw new Error("STORAGE=s3 requires S3_BUCKET");
    this.bucket = config.S3_BUCKET;
    // SDK v3 adds a CRC32 of the (empty) body to presigned URLs by default, and S3 then
    // rejects the browser's real upload with BadDigest. Only checksum when an API requires it.
    const base = { ...awsClientConfig(config.S3_REGION), requestChecksumCalculation: "WHEN_REQUIRED" as const };
    this.client = new S3Client(base);
    this.signer = config.S3_PUBLIC_ENDPOINT ? new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT, forcePathStyle: true }) : this.client;
  }

  async presignPut(key: string, contentType: string, sizeBytes: number): Promise<PresignedPut> {
    const expiresIn = 600;
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes }),
      { expiresIn, signableHeaders: new Set(["content-type", "content-length"]) },
    );
    return { url, method: "PUT", headers: { "Content-Type": contentType }, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  }

  async signedGetUrl(key: string, opts: { downloadName?: string } = {}): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(opts.downloadName ? { ResponseContentDisposition: `attachment; filename="${opts.downloadName.replace(/["\\\r\n]/g, "_")}"` } : {}),
      }),
      { expiresIn: config.SIGNED_URL_TTL_SECONDS },
    );
  }

  async head(key: string): Promise<HeadResult | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: Number(out.ContentLength ?? 0), contentType: out.ContentType ?? null };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || status === 403) return null;
      throw err;
    }
  }

  async readStart(key: string, bytes: number): Promise<Buffer> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

// ─── Local ──────────────────────────────────────────────────────────────────

const LOCAL_SIGNING_KEY = crypto.createHash("sha256").update(`${config.REFRESH_SECRET}:local-media`).digest();

/** A signed, expiring capability for one key and one operation, served by routes/media-local. */
export function signLocal(op: "get" | "put", key: string, ttlSeconds: number, extra = ""): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${op}|${key}|${exp}|${extra}`;
  const sig = crypto.createHmac("sha256", LOCAL_SIGNING_KEY).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyLocal(token: string, op: "get" | "put"): { key: string; extra: string } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const payload = Buffer.from(body, "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", LOCAL_SIGNING_KEY).update(payload).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [tokOp, key, exp, extra = ""] = payload.split("|");
  if (tokOp !== op || !key || Number(exp) < Date.now() / 1000) return null;
  return { key, extra };
}

function apiOrigin(): string {
  return config.PUBLIC_API_URL.replace(/\/$/, "");
}

class LocalStorage implements Storage {
  readonly mode = "local" as const;

  private file(key: string): string {
    const root = dataDir("media");
    const resolved = path.resolve(root, key);
    if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error("storage key escapes the media directory");
    return resolved;
  }

  async presignPut(key: string, contentType: string, sizeBytes: number): Promise<PresignedPut> {
    const token = signLocal("put", key, 600, `${contentType};${sizeBytes}`);
    return {
      url: `${apiOrigin()}/api/media/local/${token}`,
      method: "PUT",
      headers: { "Content-Type": contentType },
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    };
  }

  async signedGetUrl(key: string): Promise<string> {
    return `${apiOrigin()}/api/media/local/${signLocal("get", key, config.SIGNED_URL_TTL_SECONDS)}`;
  }

  async head(key: string): Promise<HeadResult | null> {
    try {
      const stat = await fs.promises.stat(this.file(key));
      const meta = await fs.promises.readFile(`${this.file(key)}.type`, "utf8").catch(() => null);
      return { sizeBytes: stat.size, contentType: meta };
    } catch {
      return null;
    }
  }

  async readStart(key: string, bytes: number): Promise<Buffer> {
    const handle = await fs.promises.open(this.file(key), "r");
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async get(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.file(key));
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const file = this.file(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, body);
    await fs.promises.writeFile(`${file}.type`, contentType);
  }

  async delete(key: string): Promise<void> {
    await fs.promises.rm(this.file(key), { force: true });
    await fs.promises.rm(`${this.file(key)}.type`, { force: true });
  }
}

let instance: Storage | null = null;

export function storage(): Storage {
  if (!instance) instance = config.STORAGE === "s3" ? new S3Storage() : new LocalStorage();
  return instance;
}

/** Tests swap backends between matrix runs. */
export function resetStorage(): void {
  instance = null;
}
