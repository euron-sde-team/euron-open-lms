import http from "node:http";
import type { Playback, ProgressResult } from "@open-lms/types";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/** The fake EVS lives on a port fixed before the app (and its config) is imported. */
const evs = vi.hoisted(() => {
  const port = 41000 + (process.pid % 9000);
  process.env.EVS_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.EVS_PLAYBACK_KEY = "evs-test-playback-key";
  return { port, calls: [] as { path: string; auth: string | undefined; body: { viewerId?: string; origin?: string } }[] };
});

import { db } from "../../src/db/kysely";
import { anon, as, createCourse, createUser, enroll } from "./harness";

let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      evs.calls.push({ path: req.url ?? "", auth: req.headers.authorization, body });
      if (req.url?.includes("/v1/videos/missing/")) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: "ps_1", expiresAt: "2030-01-01T00:00:00.000Z", manifestUrl: "https://evs.example.test/m/ps_1.m3u8?t=signed", posterUrl: "https://evs.example.test/p.jpg", watermark: { required: true, text: `viewer ${body.viewerId}` } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(evs.port, "127.0.0.1", resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const play = (user: Parameters<typeof as>[0], itemId: string) => as(user).post(`/api/learn/items/${itemId}/playback`).send({});

async function setVideo(itemId: string, provider: "EVS" | "HLS" | "MP4" | "YOUTUBE", ref: string, status: "READY" | "PROCESSING" | "FAILED" = "READY") {
  await db.updateTable("lectures").set({ video_provider: provider, video_ref: ref, video_status: status }).where("item_id", "=", itemId).execute();
}

describe("learning: playback", () => {
  test("HLS: the URL, the learner's email as watermark and the resume point", async () => {
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    const first = (await play(ada, course.items[0]!).expect(200)).body as Playback;
    expect(first).toEqual({ provider: "HLS", url: `https://media.example.test/${course.items[0]}/master.m3u8`, posterUrl: null, watermark: ada.email, resumeAt: 0, expiresAt: null });
    const r = (await as(ada).post(`/api/learn/items/${course.items[0]}/progress`).send({ positionSeconds: 33, playedSeconds: 30 }).expect(200)).body as ProgressResult;
    expect(r.progress.positionSeconds).toBe(33);
    expect(((await play(ada, course.items[0]!).expect(200)).body as Playback).resumeAt).toBe(33);
  });

  test("YouTube: a no-cookie embed, from an id or a URL", async () => {
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    await setVideo(course.items[0]!, "YOUTUBE", "dQw4w9WgXcQ");
    expect((await play(ada, course.items[0]!).expect(200)).body).toEqual({ provider: "YOUTUBE", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0", resumeAt: 0, watermark: null, expiresAt: null });
    await setVideo(course.items[2]!, "YOUTUBE", "https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    expect(((await play(ada, course.items[2]!).expect(200)).body as { embedUrl: string }).embedUrl).toContain("/embed/aqz-KE-bpKQ?rel=0");
  });

  test("EVS: a session minted for this viewer and the web origin, after the access check", async () => {
    const course = await createCourse({ items: [{ kind: "VIDEO", isPreview: true }, { kind: "VIDEO" }] });
    const ada = await createUser();
    await enroll(ada, course.id);
    await setVideo(course.items[0]!, "EVS", "vid_preview");
    await setVideo(course.items[1]!, "EVS", "vid_main");
    evs.calls.length = 0;

    const p = (await play(ada, course.items[1]!).expect(200)).body as Playback;
    expect(p).toEqual({ provider: "EVS", manifestUrl: "https://evs.example.test/m/ps_1.m3u8?t=signed", thumbnailsUrl: null, posterUrl: "https://evs.example.test/p.jpg", watermark: `viewer ${ada.id}`, expiresAt: "2030-01-01T00:00:00.000Z", resumeAt: 0 });
    expect(evs.calls).toEqual([{ path: "/v1/videos/vid_main/playback-sessions", auth: "Bearer evs-test-playback-key", body: { viewerId: ada.id, origin: "http://localhost:3530" } }]);

    // A signed-out preview is minted for an anonymous viewer; nothing is minted without access.
    await play(null, course.items[0]!).expect(200);
    expect(evs.calls[1]!.body.viewerId).toBe("preview-anon");
    const stranger = await createUser();
    await play(stranger, course.items[1]!).expect(403);
    await play(null, course.items[1]!).expect(403);
    expect(evs.calls).toHaveLength(2);

    await setVideo(course.items[1]!, "EVS", "missing");
    expect((await play(ada, course.items[1]!).expect(404)).body.code).toBe("VIDEO_NOT_FOUND");
  });

  test("not ready, not a video, unknown keys", async () => {
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    await setVideo(course.items[0]!, "HLS", "https://media.example.test/x.m3u8", "PROCESSING");
    expect((await play(ada, course.items[0]!).expect(409)).body.code).toBe("VIDEO_NOT_READY");
    expect((await play(ada, course.items[1]!).expect(409)).body.code).toBe("NOT_A_VIDEO");
    await as(ada).post(`/api/learn/items/${course.items[2]}/playback`).send({ quality: "max" }).expect(400);
    await anon().post(`/api/learn/items/${course.items[2]}/playback`).send({}).expect(403);
  });

  test("playback is rate limited per viewer", async () => {
    const course = await createCourse();
    const ada = await createUser();
    await enroll(ada, course.id);
    process.env.RATE_LIMITS = "on";
    try {
      let last = 200;
      for (let i = 0; i < 121; i++) last = (await play(ada, course.items[0]!)).status;
      expect(last).toBe(429);
    } finally {
      process.env.RATE_LIMITS = "off";
    }
  });
});
