/** Upload helpers for the media, submission and lecture tests: presigned PUT, signed GET, create + put + complete. */
import request from "supertest";
import { config } from "../../src/core/config";
import { app, as, type TestUser } from "./harness";

/** PUT bytes to a presigned URL: in-process for local storage, over HTTP for S3. */
export async function putBytes(put: { url: string; headers: Record<string, string> }, body: Buffer) {
  const origin = config.PUBLIC_API_URL.replace(/\/$/, "");
  if (put.url.startsWith(origin)) {
    let r = request(app).put(put.url.slice(origin.length));
    for (const [k, v] of Object.entries(put.headers)) r = r.set(k, v);
    return r.send(body);
  }
  const res = await fetch(put.url, { method: "PUT", headers: put.headers, body });
  return { status: res.status };
}

/** GET a signed media URL (local or S3) and return status, headers and bytes. */
export async function getUrl(url: string): Promise<{ status: number; type: string | null; body: Buffer; headers: Record<string, string> }> {
  const origin = config.PUBLIC_API_URL.replace(/\/$/, "");
  if (url.startsWith(origin)) {
    const res = await request(app)
      .get(url.slice(origin.length))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    return { status: res.status, type: res.headers["content-type"] ?? null, body: res.body as Buffer, headers: res.headers as Record<string, string> };
  }
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get("content-type"), body: Buffer.from(await res.arrayBuffer()), headers: Object.fromEntries(res.headers.entries()) };
}

/** Create, upload and complete. Returns the upload id and the complete response. */
export async function upload(user: TestUser, purpose: string, fileName: string, mimeType: string, bytes: Buffer, expectStatus = 200) {
  const created = await as(user).post("/api/media/uploads").send({ purpose, fileName, mimeType, sizeBytes: bytes.length }).expect(201);
  const put = await putBytes(created.body.put, bytes);
  if (put.status !== 204 && put.status !== 200) throw new Error(`upload PUT failed with ${put.status}`);
  const done = await as(user).post(`/api/media/uploads/${created.body.uploadId}/complete`).expect(expectStatus);
  return { uploadId: created.body.uploadId as string, res: done };
}

export const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
export const TINY_PDF = Buffer.from("%PDF-1.4\n%test document\n");
