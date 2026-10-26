import { describe, expect, it, vi } from "vitest";
import { HttpClient, mimeTypeOf, uploadMedia, validateUpload } from "../src";
import { json } from "./fixtures";

class FakeXhr {
  static instances: FakeXhr[] = [];
  method = "";
  url = "";
  headers: Record<string, string> = {};
  status = 0;
  body: unknown;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor(private readonly outcome: "ok" | "fail" | "error") {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  abort() {
    this.onabort?.();
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
      if (this.outcome === "error") return this.onerror?.();
      this.status = this.outcome === "ok" ? 200 : 403;
      this.onload?.();
    });
  }
}

function client(handler: (url: string, init: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  return { http: new HttpClient({ baseUrl: "/api", getAccessToken: () => "t", fetch: fetchMock as unknown as typeof fetch }), fetchMock };
}

const ticket = { uploadId: "up1", put: { url: "https://s3.local/bucket/key?sig=1", method: "PUT", headers: { "Content-Type": "image/png", "Content-Length": "4" }, expiresAt: "" } };
const media = { id: "up1", kind: "IMAGE", mimeType: "image/png", fileName: "a.png", sizeBytes: 4, width: 1, height: 1, durationSeconds: null, url: "u", thumbUrl: null, status: "READY" };

describe("uploadMedia", () => {
  it("asks for a ticket, PUTs with the presigned headers and progress, then completes", async () => {
    const { http, fetchMock } = client((url) => (url.endsWith("/media/uploads") ? json(201, ticket) : json(200, media)));
    const progress: number[] = [];
    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.png", { type: "image/png" });
    const result = await uploadMedia(http, { purpose: "SUBMISSION", file, onProgress: (f) => progress.push(f), createXhr: () => new FakeXhr("ok") as unknown as XMLHttpRequest });
    expect(result.id).toBe("up1");
    const [first, second] = fetchMock.mock.calls;
    expect(JSON.parse(first![1].body as string)).toEqual({ purpose: "SUBMISSION", fileName: "a.png", mimeType: "image/png", sizeBytes: 4 });
    expect(second![0]).toBe("/api/media/uploads/up1/complete");
    const xhr = FakeXhr.instances.at(-1)!;
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(ticket.put.url);
    expect(xhr.headers).toEqual({ "Content-Type": "image/png" });
    expect(progress).toEqual([0.5, 1]);
  });

  it("discards the ticket when the PUT fails", async () => {
    const { http, fetchMock } = client((url, init) => (url.endsWith("/media/uploads") ? json(201, ticket) : init.method === "DELETE" ? new Response(null, { status: 204 }) : json(200, media)));
    const file = new File(["x"], "a.png", { type: "image/png" });
    await expect(uploadMedia(http, { purpose: "SUBMISSION", file, createXhr: () => new FakeXhr("fail") as unknown as XMLHttpRequest })).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock.mock.calls.some(([u, i]) => u === "/api/media/uploads/up1" && i.method === "DELETE")).toBe(true);
  });

  it("maps an XHR network error to NETWORK_ERROR", async () => {
    const { http } = client((url) => (url.endsWith("/media/uploads") ? json(201, ticket) : new Response(null, { status: 204 })));
    const file = new File(["x"], "a.png", { type: "image/png" });
    await expect(uploadMedia(http, { purpose: "SUBMISSION", file, createXhr: () => new FakeXhr("error") as unknown as XMLHttpRequest })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});

describe("upload validation", () => {
  it("infers a type from the extension when the browser gives none", () => {
    expect(mimeTypeOf({ type: "", name: "IMG_1.HEIC" })).toBe("image/heic");
    expect(mimeTypeOf({ type: "", name: "noext" })).toBe("application/octet-stream");
  });
  it("refuses SVG, unknown types and oversize files", () => {
    expect(validateUpload({ type: "image/svg+xml", name: "a.svg", size: 1 })).toMatch(/SVG/);
    expect(validateUpload({ type: "application/x-msdownload", name: "a.exe", size: 1 })).toMatch(/not supported/);
    expect(validateUpload({ type: "image/png", name: "a.png", size: 16 * 1024 * 1024 })).toMatch(/15 MB/);
    expect(validateUpload({ type: "video/mp4", name: "a.mp4", size: 100 * 1024 * 1024 })).toBeNull();
    // Zip archives (source code, datasets) are accepted for submissions and resources, up to 50 MB.
    expect(validateUpload({ type: "application/zip", name: "code.zip", size: 40 * 1024 * 1024 })).toBeNull();
    expect(validateUpload({ name: "code.zip", size: 1 })).toBeNull();
    expect(validateUpload({ type: "application/zip", name: "code.zip", size: 51 * 1024 * 1024 })).toMatch(/50 MB/);
  });
});
