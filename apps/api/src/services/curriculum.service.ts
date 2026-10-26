/**
 * The curriculum editor: sections, items of each kind, lecture resources, moves and the
 * questions a FIXED quiz uses.
 *
 * Every write runs in one transaction that first takes the course row lock
 * (adminCourseRepo.lock), so concurrent edits of one course run one after another and
 * positions stay dense. Moves compute the new order with domain/curriculum.ts and write
 * every affected position with the UNIQUE constraints deferred. Any id from the body or
 * the path (a section, an item, a question, an upload) is checked against the course
 * before it is used: an id from another course is a 404, never a silent cross-link.
 * courses.item_count and duration_seconds are recounted from the items in the same
 * transaction whenever an item is added, removed or changes duration.
 *
 * EVS lookups (one HTTP call) happen before the transaction opens, never inside it.
 */
import type { AdminItem, AdminSection, ItemKind, LectureKind, QuizSelection, RevealPolicy, VideoProvider, VideoStatus } from "@open-lms/types";
import type { Actor, RequestMeta } from "../core/context";
import { evsEnabled } from "../core/config";
import { withTransaction } from "../core/effects";
import { badRequest, notFound } from "../core/errors";
import { newId } from "../core/ids";
import type { Updateable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Assignments, Quizzes } from "../db/types";
import { cleanTags, normaliseVideoRef, withCriterionIds } from "../domain/authoring-rules";
import { moveAcross, moveWithin } from "../domain/curriculum";
import { maxPoints, validRubric } from "../domain/rubric";
import { safeUrl } from "../domain/safe-url";
import { itemOf, sectionsOf } from "../presenters/curriculum.presenter";
import { adminCourseRepo } from "../repositories/admin-course.repository";
import { curriculumRepo } from "../repositories/curriculum.repository";
import { questionRepo } from "../repositories/question.repository";
import { audit } from "./audit.service";
import { courseRights } from "./authoring-access.service";
import { lookupVideo } from "./evs.service";
import { claimSingle } from "./media-attach.service";

const MAX_SECTIONS = 100;
const MAX_ITEMS = 1000;
const MAX_RESOURCES = 20;

async function itemOrThrow(courseId: string, itemId: string, exec: Executor): Promise<AdminItem> {
  const item = await itemOf(courseId, itemId, exec);
  if (!item) throw notFound("Item not found", "ITEM_NOT_FOUND");
  return item;
}

async function sectionOrThrow(courseId: string, sectionId: string, exec: Executor) {
  const s = await curriculumRepo.section(courseId, sectionId, exec);
  if (!s) throw notFound("Section not found", "SECTION_NOT_FOUND");
  return s;
}

/** One write on a course's curriculum: rights, then the course lock, then `fn`. */
async function edit<T>(actor: Actor, courseId: string, fn: (trx: Executor) => Promise<T>): Promise<T> {
  await courseRights(actor, courseId, "edit");
  return withTransaction(async (trx) => {
    await adminCourseRepo.lock(courseId, trx);
    return fn(trx);
  });
}

// ─── Sections ───────────────────────────────────────────────────────────────

export async function createSection(actor: Actor, courseId: string, title: string, meta: RequestMeta): Promise<AdminSection> {
  return edit(actor, courseId, async (trx) => {
    const position = await curriculumRepo.countSections(courseId, trx);
    if (position >= MAX_SECTIONS) throw badRequest(`A course has at most ${MAX_SECTIONS} sections`, "TOO_MANY_SECTIONS");
    const id = newId();
    await curriculumRepo.insertSection({ id, course_id: courseId, title, position }, trx);
    await audit({ actorId: actor.id, action: "section.create", entityType: "course", entityId: courseId, ip: meta.ip, data: { sectionId: id } }, trx);
    return { id, title, position, items: [] };
  });
}

export async function updateSection(actor: Actor, courseId: string, sectionId: string, title: string, meta: RequestMeta): Promise<AdminSection> {
  return edit(actor, courseId, async (trx) => {
    await sectionOrThrow(courseId, sectionId, trx);
    await curriculumRepo.updateSection(courseId, sectionId, title, trx);
    await audit({ actorId: actor.id, action: "section.update", entityType: "course", entityId: courseId, ip: meta.ip, data: { sectionId } }, trx);
    return (await sectionsOf(courseId, trx)).find((s) => s.id === sectionId) as AdminSection;
  });
}

/** Deletes the section and every item in it. */
export async function deleteSection(actor: Actor, courseId: string, sectionId: string, meta: RequestMeta): Promise<void> {
  await edit(actor, courseId, async (trx) => {
    await sectionOrThrow(courseId, sectionId, trx);
    const items = await curriculumRepo.itemIdsIn(sectionId, trx);
    await curriculumRepo.deferPositions(trx);
    await curriculumRepo.deleteSection(courseId, sectionId, trx);
    await curriculumRepo.renumberSections(courseId, trx);
    await adminCourseRepo.recount(courseId, trx);
    await audit({ actorId: actor.id, action: "section.delete", entityType: "course", entityId: courseId, ip: meta.ip, data: { sectionId, items } }, trx);
  });
}

export async function moveSection(actor: Actor, courseId: string, sectionId: string, toIndex: number, meta: RequestMeta): Promise<AdminSection[]> {
  return edit(actor, courseId, async (trx) => {
    await sectionOrThrow(courseId, sectionId, trx);
    const ids = (await curriculumRepo.sections(courseId, trx)).map((s) => s.id);
    const order = moveWithin(ids, sectionId, toIndex);
    await curriculumRepo.deferPositions(trx);
    await curriculumRepo.setPositions("course_sections", { courseId }, order.map((id, position) => ({ id, position })), trx);
    await audit({ actorId: actor.id, action: "section.move", entityType: "course", entityId: courseId, ip: meta.ip, data: { sectionId, toIndex } }, trx);
    return sectionsOf(courseId, trx);
  });
}

// ─── Items ──────────────────────────────────────────────────────────────────

export async function createItem(actor: Actor, courseId: string, input: { sectionId: string; kind: ItemKind; title: string; lectureKind?: LectureKind }, meta: RequestMeta): Promise<AdminItem> {
  if (input.kind === "LECTURE" && !input.lectureKind) throw badRequest("Choose a lecture kind: VIDEO, ARTICLE or PDF", "LECTURE_KIND_REQUIRED");
  if (input.kind !== "LECTURE" && input.lectureKind) throw badRequest("Only lectures have a lecture kind", "BAD_REQUEST");
  return edit(actor, courseId, async (trx) => {
    await sectionOrThrow(courseId, input.sectionId, trx);
    const course = await adminCourseRepo.findById(courseId, trx);
    if ((course?.item_count ?? 0) >= MAX_ITEMS) throw badRequest(`A course has at most ${MAX_ITEMS} items`, "TOO_MANY_ITEMS");
    const id = newId();
    const position = await curriculumRepo.countItems(input.sectionId, trx);
    await curriculumRepo.insertItem({ id, course_id: courseId, section_id: input.sectionId, kind: input.kind, title: input.title, position }, trx);
    if (input.kind === "LECTURE") {
      const video = input.lectureKind === "VIDEO";
      await curriculumRepo.insertLecture(
        { item_id: id, lecture_kind: input.lectureKind!, video_provider: video ? (evsEnabled() ? "EVS" : "HLS") : null, video_ref: null, video_status: video ? "PROCESSING" : "READY" },
        trx,
      );
    } else if (input.kind === "QUIZ") {
      await curriculumRepo.insertQuiz({ item_id: id }, trx);
    } else {
      await curriculumRepo.insertAssignment({ item_id: id }, trx);
    }
    await adminCourseRepo.recount(courseId, trx);
    await audit({ actorId: actor.id, action: "item.create", entityType: "course_item", entityId: id, ip: meta.ip, data: { courseId, kind: input.kind, lectureKind: input.lectureKind ?? null } }, trx);
    return itemOrThrow(courseId, id, trx);
  });
}

export async function getItem(actor: Actor, courseId: string, itemId: string): Promise<AdminItem> {
  await courseRights(actor, courseId, "read");
  return itemOrThrow(courseId, itemId, db);
}

export interface ItemPatch {
  title?: string;
  isPreview?: boolean;
  durationSeconds?: number;
  lecture?: {
    lectureKind?: LectureKind;
    videoProvider?: VideoProvider;
    videoRef?: string | null;
    body?: string | null;
    pdfUploadId?: string | null;
  };
  quiz?: {
    instructions?: string | null;
    selection?: QuizSelection;
    drawCount?: number | null;
    drawTags?: string[];
    passPercent?: number;
    timeLimitSeconds?: number | null;
    maxAttempts?: number | null;
    shuffleQuestions?: boolean;
    shuffleOptions?: boolean;
    reveal?: RevealPolicy;
  };
  assignment?: {
    instructions?: string;
    rubric?: { id?: string; title: string; description?: string | null; maxPoints: number }[];
    passPoints?: number | null;
    dueDays?: number | null;
    allowLate?: boolean;
    acceptText?: boolean;
    acceptFiles?: boolean;
    acceptUrl?: boolean;
    maxFiles?: number;
  };
}

export async function updateItem(actor: Actor, courseId: string, itemId: string, patch: ItemPatch, meta: RequestMeta): Promise<AdminItem> {
  await courseRights(actor, courseId, "edit");
  const before = await itemOrThrow(courseId, itemId, db);
  const kindPatches = [patch.lecture && "LECTURE", patch.quiz && "QUIZ", patch.assignment && "ASSIGNMENT"].filter(Boolean);
  if (kindPatches.some((k) => k !== before.kind)) throw badRequest(`This item is a ${before.kind.toLowerCase()}`, "KIND_MISMATCH");
  if (patch.isPreview && before.kind !== "LECTURE") throw badRequest("Only lectures can be free previews", "PREVIEW_LECTURES_ONLY");

  // An EVS video's state is looked up before the transaction (an HTTP call).
  let evs: { status: VideoStatus; durationSeconds: number | null } | null = null;
  const l = patch.lecture;
  if (before.kind === "LECTURE" && l) {
    const kind = l.lectureKind ?? before.lecture.lectureKind;
    const provider = l.videoProvider ?? before.lecture.videoProvider ?? (evsEnabled() ? "EVS" : "HLS");
    if (kind === "VIDEO" && provider === "EVS" && typeof l.videoRef === "string") {
      const ref = normaliseVideoRef("EVS", l.videoRef);
      if (ref.ok && ref.value !== before.lecture.videoRef) evs = await lookupVideo(ref.value);
    }
  }

  return withTransaction(async (trx) => {
    await adminCourseRepo.lock(courseId, trx);
    const current = await itemOrThrow(courseId, itemId, trx);
    const changed: string[] = [];
    const itemSet: { title?: string; is_preview?: boolean; duration_seconds?: number } = {};
    if (patch.title !== undefined && patch.title !== current.title) {
      itemSet.title = patch.title;
      changed.push("title");
    }
    if (patch.isPreview !== undefined && patch.isPreview !== current.isPreview) {
      itemSet.is_preview = patch.isPreview;
      changed.push("isPreview");
    }
    if (patch.durationSeconds !== undefined && patch.durationSeconds !== current.durationSeconds) {
      itemSet.duration_seconds = patch.durationSeconds;
      changed.push("durationSeconds");
    }

    if (current.kind === "LECTURE" && l) {
      const set = await lecturePatch(actor, current, l, evs, trx);
      if (Object.keys(set.lecture).length) {
        await curriculumRepo.updateLecture(itemId, set.lecture, trx);
        changed.push(...set.fields);
      }
      if (set.durationSeconds !== null && patch.durationSeconds === undefined && set.durationSeconds !== current.durationSeconds) {
        itemSet.duration_seconds = set.durationSeconds;
        changed.push("durationSeconds");
      }
    }
    if (current.kind === "QUIZ" && patch.quiz) {
      const set = quizPatch(current, patch.quiz);
      if (Object.keys(set).length) {
        await curriculumRepo.updateQuiz(itemId, set, trx);
        changed.push(...Object.keys(patch.quiz).map((k) => `quiz.${k}`));
      }
    }
    if (current.kind === "ASSIGNMENT" && patch.assignment) {
      const set = assignmentPatch(current, patch.assignment);
      if (Object.keys(set).length) {
        await curriculumRepo.updateAssignment(itemId, set, trx);
        changed.push(...Object.keys(patch.assignment).map((k) => `assignment.${k}`));
      }
    }

    if (Object.keys(itemSet).length) await curriculumRepo.updateItem(itemId, itemSet, trx);
    if (itemSet.duration_seconds !== undefined) await adminCourseRepo.recount(courseId, trx);
    if (changed.length) await audit({ actorId: actor.id, action: "item.update", entityType: "course_item", entityId: itemId, ip: meta.ip, data: { courseId, fields: changed } }, trx);
    return itemOrThrow(courseId, itemId, trx);
  });
}

type LectureItem = Extract<AdminItem, { kind: "LECTURE" }>;
type LectureSet = { lecture_kind?: LectureKind; video_provider?: VideoProvider | null; video_ref?: string | null; video_status?: VideoStatus; body?: string | null; pdf_upload_id?: string | null };

/** The lectures row after a patch: kind, provider and ref stay consistent with each other. */
async function lecturePatch(actor: Actor, current: LectureItem, l: NonNullable<ItemPatch["lecture"]>, evs: { status: VideoStatus; durationSeconds: number | null } | null, trx: Executor): Promise<{ lecture: LectureSet; fields: string[]; durationSeconds: number | null }> {
  const cur = current.lecture;
  const kind = l.lectureKind ?? cur.lectureKind;
  const out: LectureSet = {};
  const fields: string[] = [];
  let durationSeconds: number | null = null;
  if (kind !== "VIDEO" && (l.videoProvider !== undefined || l.videoRef !== undefined)) throw badRequest("Only video lectures have a video", "NOT_A_VIDEO");
  if (kind !== "PDF" && l.pdfUploadId) throw badRequest("Only PDF lectures have a PDF", "NOT_A_PDF");
  if (kind !== cur.lectureKind) {
    out.lecture_kind = kind;
    fields.push("lectureKind");
  }

  if (kind === "VIDEO") {
    const provider = l.videoProvider ?? cur.videoProvider ?? (evsEnabled() ? "EVS" : "HLS");
    let ref = cur.videoProvider === provider ? cur.videoRef : null;
    if (l.videoRef !== undefined) {
      if (l.videoRef === null || !l.videoRef.trim()) ref = null;
      else {
        const checked = normaliseVideoRef(provider, l.videoRef);
        if (!checked.ok) throw badRequest(checked.message, "INVALID_VIDEO_REF");
        ref = checked.value;
      }
    }
    let status: VideoStatus = cur.videoStatus;
    if (ref !== cur.videoRef || provider !== cur.videoProvider) {
      if (!ref) status = "PROCESSING";
      else if (provider === "EVS") {
        status = evs?.status ?? "READY";
        durationSeconds = evs?.durationSeconds ?? null;
      } else status = "READY";
    }
    if (provider !== cur.videoProvider) {
      out.video_provider = provider;
      fields.push("videoProvider");
    }
    if (ref !== cur.videoRef) {
      out.video_ref = ref;
      fields.push("videoRef");
    }
    if (status !== cur.videoStatus || kind !== cur.lectureKind) out.video_status = status;
  } else {
    if (cur.videoProvider !== null) out.video_provider = null;
    if (cur.videoRef !== null) out.video_ref = null;
    if (cur.videoStatus !== "READY") out.video_status = "READY";
  }

  if (kind === "PDF") {
    if (l.pdfUploadId !== undefined && l.pdfUploadId !== (cur.pdf?.id ?? null)) {
      out.pdf_upload_id = await claimSingle(actor.id, l.pdfUploadId, "LECTURE_PDF", trx);
      fields.push("pdf");
    }
  } else if (cur.pdf) {
    out.pdf_upload_id = null;
  }

  if (l.body !== undefined && l.body !== cur.body) {
    out.body = l.body;
    fields.push("body");
  }
  return { lecture: out, fields, durationSeconds };
}

type QuizItem = Extract<AdminItem, { kind: "QUIZ" }>;

function quizPatch(current: QuizItem, q: NonNullable<ItemPatch["quiz"]>): Updateable<Quizzes> {
  const selection = q.selection ?? current.quiz.selection;
  const drawCount = q.drawCount !== undefined ? q.drawCount : current.quiz.drawCount;
  if (selection === "RANDOM" && !drawCount) throw badRequest("A random quiz needs a number of questions to draw", "DRAW_COUNT_REQUIRED");
  const set: Updateable<Quizzes> = {};
  if (q.instructions !== undefined) set.instructions = q.instructions;
  if (q.selection !== undefined) set.selection = q.selection;
  if (q.drawCount !== undefined) set.draw_count = q.drawCount;
  if (q.drawTags !== undefined) set.draw_tags = cleanTags(q.drawTags);
  if (q.passPercent !== undefined) set.pass_percent = q.passPercent;
  if (q.timeLimitSeconds !== undefined) set.time_limit_seconds = q.timeLimitSeconds;
  if (q.maxAttempts !== undefined) set.max_attempts = q.maxAttempts;
  if (q.shuffleQuestions !== undefined) set.shuffle_questions = q.shuffleQuestions;
  if (q.shuffleOptions !== undefined) set.shuffle_options = q.shuffleOptions;
  if (q.reveal !== undefined) set.reveal = q.reveal;
  return set;
}

type AssignmentItem = Extract<AdminItem, { kind: "ASSIGNMENT" }>;

function assignmentPatch(current: AssignmentItem, a: NonNullable<ItemPatch["assignment"]>): Updateable<Assignments> {
  const rubric = a.rubric !== undefined ? withCriterionIds(a.rubric) : current.assignment.rubric;
  const problem = validRubric(rubric);
  if (problem) throw badRequest(problem, "INVALID_RUBRIC");
  const passPoints = a.passPoints !== undefined ? a.passPoints : current.assignment.passPoints;
  if (passPoints !== null && rubric.length && passPoints > maxPoints(rubric)) throw badRequest("The pass mark is higher than the rubric's total", "PASS_POINTS_TOO_HIGH");
  const accepts = { text: a.acceptText ?? current.assignment.acceptText, files: a.acceptFiles ?? current.assignment.acceptFiles, url: a.acceptUrl ?? current.assignment.acceptUrl };
  if (!accepts.text && !accepts.files && !accepts.url) throw badRequest("Accept at least one kind of submission: text, files or a link", "NO_SUBMISSION_TYPE");
  const set: Updateable<Assignments> = {};
  if (a.instructions !== undefined) set.instructions = a.instructions;
  if (a.rubric !== undefined) set.rubric = JSON.stringify(rubric);
  if (a.passPoints !== undefined) set.pass_points = a.passPoints;
  if (a.dueDays !== undefined) set.due_days = a.dueDays;
  if (a.allowLate !== undefined) set.allow_late = a.allowLate;
  if (a.acceptText !== undefined) set.accept_text = a.acceptText;
  if (a.acceptFiles !== undefined) set.accept_files = a.acceptFiles;
  if (a.acceptUrl !== undefined) set.accept_url = a.acceptUrl;
  if (a.maxFiles !== undefined) set.max_files = a.maxFiles;
  return set;
}

export async function deleteItem(actor: Actor, courseId: string, itemId: string, meta: RequestMeta): Promise<void> {
  await edit(actor, courseId, async (trx) => {
    const item = await curriculumRepo.item(courseId, itemId, trx);
    if (!item) throw notFound("Item not found", "ITEM_NOT_FOUND");
    await curriculumRepo.deferPositions(trx);
    await curriculumRepo.deleteItem(courseId, itemId, trx);
    await curriculumRepo.renumberItems(item.section_id, trx);
    await adminCourseRepo.recount(courseId, trx);
    await audit({ actorId: actor.id, action: "item.delete", entityType: "course_item", entityId: itemId, ip: meta.ip, data: { courseId, kind: item.kind, title: item.title } }, trx);
  });
}

/** Move an item within its section or into another section of the same course. */
export async function moveItem(actor: Actor, courseId: string, itemId: string, input: { sectionId: string; toIndex: number }, meta: RequestMeta): Promise<AdminSection[]> {
  return edit(actor, courseId, async (trx) => {
    const item = await curriculumRepo.item(courseId, itemId, trx);
    if (!item) throw notFound("Item not found", "ITEM_NOT_FOUND");
    await sectionOrThrow(courseId, input.sectionId, trx);
    await curriculumRepo.deferPositions(trx);
    const source = await curriculumRepo.itemIdsIn(item.section_id, trx);
    if (input.sectionId === item.section_id) {
      const order = moveWithin(source, itemId, input.toIndex);
      await curriculumRepo.setPositions("course_items", { courseId }, order.map((id, position) => ({ id, position })), trx);
    } else {
      const target = await curriculumRepo.itemIdsIn(input.sectionId, trx);
      const next = moveAcross(source, target, itemId, input.toIndex);
      await curriculumRepo.setPositions(
        "course_items",
        { courseId },
        [...next.source.map((id, position) => ({ id, position })), ...next.target.map((id, position) => ({ id, position, sectionId: input.sectionId }))],
        trx,
      );
    }
    await audit({ actorId: actor.id, action: "item.move", entityType: "course_item", entityId: itemId, ip: meta.ip, data: { courseId, from: item.section_id, to: input.sectionId, toIndex: input.toIndex } }, trx);
    return sectionsOf(courseId, trx);
  });
}

// ─── Resources and quiz questions ───────────────────────────────────────────

export async function addResource(actor: Actor, courseId: string, itemId: string, input: { title: string; uploadId?: string; url?: string }, meta: RequestMeta): Promise<AdminItem> {
  if (!!input.uploadId === !!input.url) throw badRequest("Attach a file or a link, not both", "RESOURCE_SOURCE");
  let url: string | null = null;
  if (input.url) {
    url = safeUrl(input.url);
    if (!url || !/^https:\/\//i.test(input.url.trim())) throw badRequest("Use an https:// link", "INVALID_URL");
  }
  return edit(actor, courseId, async (trx) => {
    const item = await curriculumRepo.item(courseId, itemId, trx);
    if (!item) throw notFound("Item not found", "ITEM_NOT_FOUND");
    if (item.kind !== "LECTURE") throw badRequest("Resources attach to lectures", "NOT_A_LECTURE");
    const position = await curriculumRepo.countResources(itemId, trx);
    if (position >= MAX_RESOURCES) throw badRequest(`A lecture has at most ${MAX_RESOURCES} resources`, "TOO_MANY_RESOURCES");
    const uploadId = input.uploadId ? await claimSingle(actor.id, input.uploadId, "LECTURE_RESOURCE", trx) : null;
    const id = newId();
    await curriculumRepo.insertResource({ id, item_id: itemId, title: input.title, upload_id: uploadId, url, position }, trx);
    await audit({ actorId: actor.id, action: "item.update", entityType: "course_item", entityId: itemId, ip: meta.ip, data: { courseId, fields: ["resources"], added: id } }, trx);
    return itemOrThrow(courseId, itemId, trx);
  });
}

export async function deleteResource(actor: Actor, courseId: string, itemId: string, resourceId: string, meta: RequestMeta): Promise<AdminItem> {
  return edit(actor, courseId, async (trx) => {
    const item = await curriculumRepo.item(courseId, itemId, trx);
    if (!item) throw notFound("Item not found", "ITEM_NOT_FOUND");
    const r = await curriculumRepo.deleteResource(itemId, resourceId, trx);
    if (Number(r.numDeletedRows) !== 1) throw notFound("Resource not found", "RESOURCE_NOT_FOUND");
    await audit({ actorId: actor.id, action: "item.update", entityType: "course_item", entityId: itemId, ip: meta.ip, data: { courseId, fields: ["resources"], removed: resourceId } }, trx);
    return itemOrThrow(courseId, itemId, trx);
  });
}

/** The questions of a FIXED quiz, in order. Every id must be a live question of this course. */
export async function setQuizQuestions(actor: Actor, courseId: string, itemId: string, questionIds: string[], meta: RequestMeta): Promise<AdminItem> {
  if (new Set(questionIds).size !== questionIds.length) throw badRequest("A question is listed twice", "DUPLICATE_QUESTION");
  return edit(actor, courseId, async (trx) => {
    const item = await itemOrThrow(courseId, itemId, trx);
    if (item.kind !== "QUIZ") throw badRequest("This item is not a quiz", "NOT_A_QUIZ");
    if (item.quiz.selection !== "FIXED") throw badRequest("A random quiz draws from the bank by tag; switch it to FIXED to pick questions", "NOT_FIXED_QUIZ");
    const live = await questionRepo.liveIdsIn(courseId, questionIds, trx);
    if (live.size !== questionIds.length) throw badRequest("One of the questions is not in this course's bank", "QUESTION_NOT_IN_COURSE");
    await curriculumRepo.replaceQuizQuestions(itemId, questionIds, trx);
    await audit({ actorId: actor.id, action: "item.update", entityType: "course_item", entityId: itemId, ip: meta.ip, data: { courseId, fields: ["questions"], count: questionIds.length } }, trx);
    return itemOrThrow(courseId, itemId, trx);
  });
}
