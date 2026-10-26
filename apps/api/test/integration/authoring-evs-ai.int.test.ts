/**
 * Authoring: the EVS webhook (signature, ready/failed, durations, unrelated ids), the
 * EVS video picker and status lookups (EVS stubbed at fetch), and AI drafting.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { config } from "../../src/core/config";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { setAiProviderForTests, type AiProvider } from "../../src/integrations/ai";
import { signWebhook } from "../../src/integrations/evs";
import { anon, as, createUser, type TestUser } from "./harness";

const SECRET = "evs-webhook-test-secret";

async function evsLecture(owner: TestUser, videoId: string) {
  const c = (await as(owner).post("/api/admin/courses").send({ title: "Video Course" }).expect(201)).body as { id: string };
  const s = (await as(owner).post(`/api/admin/courses/${c.id}/sections`).send({ title: "S" }).expect(201)).body as { id: string };
  const it = (await as(owner).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "LECTURE", title: "Watch", lectureKind: "VIDEO" }).expect(201)).body as { id: string };
  await as(owner).patch(`/api/admin/courses/${c.id}/items/${it.id}`).send({ lecture: { videoProvider: "EVS", videoRef: videoId } }).expect(200);
  await db.updateTable("lectures").set({ video_status: "PROCESSING" }).where("item_id", "=", it.id).execute();
  return { courseId: c.id, itemId: it.id };
}

function send(body: object, signature?: string) {
  const raw = JSON.stringify(body);
  return anon()
    .post("/api/webhooks/evs")
    .set("Content-Type", "application/json")
    .set("EVS-Signature", signature ?? signWebhook(raw, SECRET))
    .send(raw);
}

const lectureState = (itemId: string) =>
  db.selectFrom("lectures as l").innerJoin("course_items as ci", "ci.id", "l.item_id").select(["l.video_status", "ci.duration_seconds"]).where("l.item_id", "=", itemId).executeTakeFirstOrThrow();

afterEach(() => {
  config.EVS_WEBHOOK_SECRET = undefined;
  config.EVS_BASE_URL = undefined;
  config.EVS_READ_KEY = undefined;
  setAiProviderForTests(null);
  vi.restoreAllMocks();
});

describe("EVS webhook", () => {
  test("bad or missing signatures are 400; nothing changes", async () => {
    config.EVS_WEBHOOK_SECRET = SECRET;
    const owner = await createUser({ role: "INSTRUCTOR" });
    const videoId = `vid_${newId()}`;
    const { itemId } = await evsLecture(owner, videoId);
    const body = { id: "evt_1", type: "video.ready", createdAt: new Date().toISOString(), data: { videoId } };
    expect((await send(body, signWebhook(JSON.stringify(body), "wrong-secret")).expect(400)).body.code).toBe("BAD_SIGNATURE");
    expect((await send(body, "t=1,v1=abc").expect(400)).body.code).toBe("BAD_SIGNATURE");
    expect((await anon().post("/api/webhooks/evs").set("Content-Type", "application/json").send(JSON.stringify(body)).expect(400)).body.code).toBe("BAD_SIGNATURE");
    const stale = signWebhook(JSON.stringify(body), SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect((await send(body, stale).expect(400)).body.code).toBe("BAD_SIGNATURE");
    expect((await lectureState(itemId)).video_status).toBe("PROCESSING");
  });

  test("video.ready sets READY and the duration (item and course totals); video.failed sets FAILED; redelivery is harmless", async () => {
    config.EVS_WEBHOOK_SECRET = SECRET;
    const owner = await createUser({ role: "INSTRUCTOR" });
    const videoId = `vid_${newId()}`;
    const { courseId, itemId } = await evsLecture(owner, videoId);
    const ready = { id: "evt_ready", type: "video.ready", createdAt: new Date().toISOString(), data: { videoId, durationSeconds: 421.6 } };
    expect((await send(ready).expect(200)).body).toEqual({ received: true, updated: 1 });
    expect(await lectureState(itemId)).toEqual({ video_status: "READY", duration_seconds: 422 });
    expect((await db.selectFrom("courses").select("duration_seconds").where("id", "=", courseId).executeTakeFirstOrThrow()).duration_seconds).toBe(422);
    await send(ready).expect(200);
    expect(await lectureState(itemId)).toEqual({ video_status: "READY", duration_seconds: 422 });
    const editor = await as(owner).get(`/api/admin/courses/${courseId}`).expect(200);
    expect(editor.body.publishChecklist.map((c: { code: string }) => c.code)).not.toContain("VIDEO_NOT_READY");

    await send({ id: "evt_failed", type: "video.failed", createdAt: new Date().toISOString(), data: { videoId, error: "codec" } }).expect(200);
    expect((await lectureState(itemId)).video_status).toBe("FAILED");
    const after = await as(owner).get(`/api/admin/courses/${courseId}`).expect(200);
    expect(after.body.publishChecklist).toContainEqual(expect.objectContaining({ code: "VIDEO_NOT_READY", itemId }));
  });

  test("unrelated ids, other providers and unknown event types are no-ops", async () => {
    config.EVS_WEBHOOK_SECRET = SECRET;
    const owner = await createUser({ role: "INSTRUCTOR" });
    const videoId = `vid_${newId()}`;
    const { itemId } = await evsLecture(owner, videoId);
    expect((await send({ id: "e1", type: "video.ready", data: { videoId: `vid_${newId()}` } }).expect(200)).body.updated).toBe(0);
    expect((await send({ id: "e2", type: "video.deleted", data: { videoId } }).expect(200)).body.updated).toBe(0);
    expect((await send({ id: "e3", type: "video.ready", data: { videoId: "../bad id" } }).expect(200)).body.updated).toBe(0);
    expect((await lectureState(itemId)).video_status).toBe("PROCESSING");
    const raw = "not json";
    expect((await anon().post("/api/webhooks/evs").set("Content-Type", "text/plain").set("EVS-Signature", signWebhook(raw, SECRET)).send(raw).expect(400)).body.code).toBe("BAD_PAYLOAD");
  });

  test("without a configured secret the webhook is refused", async () => {
    const res = await send({ id: "e", type: "video.ready", data: { videoId: "x" } }).expect(503);
    expect(res.body.code).toBe("EVS_WEBHOOK_NOT_CONFIGURED");
  });
});

describe("EVS picker", () => {
  test("status reports what is configured; the picker needs a read key; courses area only", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    expect((await as(teacher).get("/api/admin/evs/status").expect(200)).body).toEqual({ configured: false, canListVideos: false });
    expect((await as(teacher).get("/api/admin/evs/videos").expect(503)).body.code).toBe("VIDEO_LIBRARY_NOT_CONFIGURED");
    const finance = await createUser({ role: "FINANCE" });
    await as(finance).get("/api/admin/evs/status").expect(403);
    await as(null).get("/api/admin/evs/videos").expect(401);
  });

  test("lists EVS videos, and attaching a video takes its status and duration from EVS", async () => {
    config.EVS_BASE_URL = "https://evs.example.test";
    config.EVS_READ_KEY = "read-key";
    const videos = [
      { id: "vid_ready", title: "Ready one", status: "ready", durationSeconds: 61, posterUrl: null, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "vid_busy", title: "Busy one", status: "transcoding", durationSeconds: null, posterUrl: null, createdAt: "2026-01-02T00:00:00.000Z" },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      const q = url.searchParams.get("q");
      const data = q ? videos.filter((v) => v.id === q || v.title.includes(q)) : videos;
      return new Response(JSON.stringify({ data, pagination: { page: 1, total: data.length } }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const list = await as(teacher).get("/api/admin/evs/videos?q=one").expect(200);
    expect(list.body).toEqual({ items: videos, page: 1, total: 2 });
    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ headers: expect.objectContaining({ Authorization: "Bearer read-key" }) });

    const c = (await as(teacher).post("/api/admin/courses").send({ title: "Picked Videos" }).expect(201)).body as { id: string };
    const s = (await as(teacher).post(`/api/admin/courses/${c.id}/sections`).send({ title: "S" }).expect(201)).body as { id: string };
    const a = (await as(teacher).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "LECTURE", title: "A", lectureKind: "VIDEO" }).expect(201)).body as { id: string };
    const b = (await as(teacher).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "LECTURE", title: "B", lectureKind: "VIDEO" }).expect(201)).body as { id: string };
    const ra = await as(teacher).patch(`/api/admin/courses/${c.id}/items/${a.id}`).send({ lecture: { videoProvider: "EVS", videoRef: "vid_ready" } }).expect(200);
    expect(ra.body).toMatchObject({ durationSeconds: 61, lecture: { videoStatus: "READY" } });
    const rb = await as(teacher).patch(`/api/admin/courses/${c.id}/items/${b.id}`).send({ lecture: { videoProvider: "EVS", videoRef: "vid_busy" } }).expect(200);
    expect(rb.body.lecture.videoStatus).toBe("PROCESSING");
    expect((await db.selectFrom("courses").select("duration_seconds").where("id", "=", c.id).executeTakeFirstOrThrow()).duration_seconds).toBe(61);
  });
});

describe("AI drafting", () => {
  const LESSON = "A LEFT JOIN returns every row from the left table and the matching rows from the right table. Rows without a match get NULLs on the right side.";

  function stubProvider(raw: unknown): { provider: AiProvider; calls: { system: string; user: string }[] } {
    const calls: { system: string; user: string }[] = [];
    return {
      calls,
      provider: {
        name: "test",
        json: async (task) => {
          calls.push({ system: task.system, user: task.user });
          return { raw, usage: { model: "test-model", tokensIn: 10, tokensOut: 10 } };
        },
      },
    };
  }

  test("drafts come back validated and are never saved; the item's article is the default source", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const c = (await as(teacher).post("/api/admin/courses").send({ title: "AI Course" }).expect(201)).body as { id: string };
    const s = (await as(teacher).post(`/api/admin/courses/${c.id}/sections`).send({ title: "S" }).expect(201)).body as { id: string };
    const it = (await as(teacher).post(`/api/admin/courses/${c.id}/items`).send({ sectionId: s.id, kind: "LECTURE", title: "Joins", lectureKind: "ARTICLE" }).expect(201)).body as { id: string };
    await as(teacher).patch(`/api/admin/courses/${c.id}/items/${it.id}`).send({ lecture: { body: LESSON } }).expect(200);
    const stub = stubProvider({
      questions: [
        { kind: "SINGLE", prompt: "Which rows does a LEFT JOIN keep?", explanation: "All left rows.", options: [{ text: "All left rows", correct: true }, { text: "Only matches", correct: false }], acceptedAnswers: [] },
        { kind: "SINGLE", prompt: "Broken: two correct", explanation: "", options: [{ text: "A", correct: true }, { text: "B", correct: true }], acceptedAnswers: [] },
        { kind: "SHORT_TEXT", prompt: "What fills unmatched right columns?", explanation: "NULL.", options: [], acceptedAnswers: ["NULL"] },
      ],
    });
    setAiProviderForTests(stub.provider);
    const res = await as(teacher).post(`/api/admin/courses/${c.id}/ai/questions`).send({ itemId: it.id, count: 3, kinds: ["SINGLE", "SHORT_TEXT"] }).expect(200);
    expect(res.body.drafts).toEqual([
      { kind: "SINGLE", prompt: "Which rows does a LEFT JOIN keep?", explanation: "All left rows.", points: 1, options: [{ id: "a", text: "All left rows", correct: true }, { id: "b", text: "Only matches", correct: false }], acceptedAnswers: [], matchMode: "CASE_INSENSITIVE", tags: [] },
      { kind: "SHORT_TEXT", prompt: "What fills unmatched right columns?", explanation: "NULL.", points: 1, options: [], acceptedAnswers: ["NULL"], matchMode: "CASE_INSENSITIVE", tags: [] },
    ]);
    expect(stub.calls[0]!.user).toContain("LEFT JOIN returns every row");
    expect(await db.selectFrom("questions").select("id").where("course_id", "=", c.id).execute()).toEqual([]);

    // Too little text, an item of another course, a grader, and AI being off.
    expect((await as(teacher).post(`/api/admin/courses/${c.id}/ai/questions`).send({ sourceText: "short", count: 2, kinds: ["SINGLE"] }).expect(400)).body.code).toBe("NO_SOURCE_TEXT");
    const other = (await as(teacher).post("/api/admin/courses").send({ title: "Other AI Course" }).expect(201)).body as { id: string };
    expect((await as(teacher).post(`/api/admin/courses/${other.id}/ai/questions`).send({ itemId: it.id, count: 2, kinds: ["SINGLE"] }).expect(404)).body.code).toBe("ITEM_NOT_FOUND");
    await as(teacher).post(`/api/admin/courses/${c.id}/ai/questions`).send({ sourceText: LESSON, count: 21, kinds: ["SINGLE"] }).expect(400);
    const stranger = await createUser({ role: "INSTRUCTOR" });
    await as(stranger).post(`/api/admin/courses/${c.id}/ai/questions`).send({ sourceText: LESSON, count: 2, kinds: ["SINGLE"] }).expect(404);

    setAiProviderForTests(null);
    const previous = config.AI_PROVIDER;
    config.AI_PROVIDER = "none";
    try {
      expect((await as(teacher).post(`/api/admin/courses/${c.id}/ai/questions`).send({ sourceText: LESSON, count: 2, kinds: ["SINGLE"] }).expect(503)).body.code).toBe("AI_UNAVAILABLE");
      expect((await as(teacher).post(`/api/admin/courses/${c.id}/ai/polish`).send({ field: "subtitle", text: "x" }).expect(503)).body.code).toBe("AI_UNAVAILABLE");
    } finally {
      config.AI_PROVIDER = previous;
    }
  });

  test("polish returns text without saving; a provider error is 502; the per-user budget is enforced", async () => {
    const teacher = await createUser({ role: "INSTRUCTOR" });
    const c = (await as(teacher).post("/api/admin/courses").send({ title: "Polish Course" }).expect(201)).body as { id: string };
    setAiProviderForTests(stubProvider({ text: "Write SQL that answers real questions" }).provider);
    const res = await as(teacher).post(`/api/admin/courses/${c.id}/ai/polish`).send({ field: "subtitle", text: "sql stuff, answering things" }).expect(200);
    expect(res.body).toEqual({ text: "Write SQL that answers real questions" });
    expect((await db.selectFrom("courses").select("subtitle").where("id", "=", c.id).executeTakeFirstOrThrow()).subtitle).toBeNull();
    await as(teacher).post(`/api/admin/courses/${c.id}/ai/polish`).send({ field: "title", text: "x" }).expect(400);

    setAiProviderForTests({ name: "broken", json: async () => Promise.reject(new Error("upstream 500")) });
    expect((await as(teacher).post(`/api/admin/courses/${c.id}/ai/polish`).send({ field: "subtitle", text: "x" }).expect(502)).body.code).toBe("AI_FAILED");

    setAiProviderForTests(stubProvider({ text: "ok" }).provider);
    process.env.RATE_LIMITS = "on";
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 31; i++) statuses.push((await as(teacher).post(`/api/admin/courses/${c.id}/ai/polish`).send({ field: "subtitle", text: "x" })).status);
      expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
      expect(statuses[30]).toBe(429);
    } finally {
      delete process.env.RATE_LIMITS;
    }
  });
});
