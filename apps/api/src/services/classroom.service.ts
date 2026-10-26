/**
 * The classroom: the curriculum with the learner's progress, one item's content, video
 * heartbeats, "Mark as done" and bookmarks. Every entry point goes through
 * services/access.service.ts first (requireCourseAccess / requireItemAccess); nothing
 * here reads enrollments to decide access.
 *
 * Who writes progress:
 *   - a learner with an enrollment (subscription access creates one on first open);
 *   - staff with no enrollment browse with role STAFF: progress writes are 409
 *     STAFF_PREVIEW, so authors never pollute their own analytics;
 *   - someone opening a free preview without access: 409 PREVIEW.
 *
 * Every progress write locks the learner's enrollment row first. Completion counts
 * the curriculum in SQL (services/progress.service.ts), and without the lock two
 * final beats on two different items, committed at the same moment, could each miss
 * the other's completion and leave the course unfinished.
 *
 * Quiz attempts and submissions belong to the assessments services: the QUIZ and
 * ASSIGNMENT content comes from their quizOverview() / assignmentView(), which never
 * expose questions or answer keys.
 */
import type { Classroom, ClassroomItem, ItemContent, ProgressBeat, ProgressResult } from "@open-lms/types";
import type { Actor } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict, notFound } from "../core/errors";
import { neighbours, resumeTarget } from "../domain/curriculum";
import { renderAuthored } from "../domain/markdown";
import { applyBeat, videoComplete } from "../domain/progress";
import { presentCurriculum } from "../presenters/catalog.presenter";
import { EMPTY_PROGRESS, presentResources, toItemProgress } from "../presenters/classroom.presenter";
import { loadMedia, urlOf } from "../presenters/media.presenter";
import { catalogRepo } from "../repositories/catalog.repository";
import { classroomRepo } from "../repositories/classroom.repository";
import { requireCourseAccess, requireItemAccess } from "./access.service";
import { markItemComplete } from "./progress.service";
import { quizOverview } from "./quiz.service";
import { assignmentView } from "./submission.service";
import { getSettings } from "./settings.service";

/** A beat may describe a video of at most six hours when the item has no duration. */
const MAX_BEAT_DURATION = 6 * 3600;

export async function classroom(actor: Actor, slug: string): Promise<Classroom> {
  const granted = await requireCourseAccess(actor, { slug });
  const courseId = granted.course.id;
  const [curriculum, course, progress, quizzes, submissions, bookmarks, certificate, enrollment, settings] = await Promise.all([
    catalogRepo.curriculum(courseId),
    catalogRepo.courseBySlug(granted.course.slug),
    classroomRepo.progressForCourse(actor.id, courseId),
    classroomRepo.quizBests(actor.id, courseId),
    classroomRepo.latestSubmissions(actor.id, courseId),
    classroomRepo.bookmarkedIds(actor.id, courseId),
    classroomRepo.certificateFor(actor.id, courseId),
    granted.enrollmentId ? classroomRepo.enrollment(granted.enrollmentId) : Promise.resolve(undefined),
    getSettings(),
  ]);
  if (!course) throw notFound("Course not found");
  const cover = await loadMedia([course.cover_upload_id]);
  const progressBy = new Map(progress.map((p) => [p.item_id, p]));
  const quizBy = new Map(quizzes.map((q) => [q.quiz_item_id, q]));
  const submissionBy = new Map(submissions.map((s) => [s.item_id, s.status]));
  const completed = new Set(progress.filter((p) => p.completed_at).map((p) => p.item_id));

  const sections = presentCurriculum(curriculum).map((s) => {
    const items = s.items.map((i): ClassroomItem => {
      const q = quizBy.get(i.id);
      return {
        ...i,
        progress: toItemProgress(progressBy.get(i.id), i.durationSeconds),
        status: i.kind === "QUIZ" ? { kind: "QUIZ", bestPercent: q?.best ?? null, passed: !!q?.passed } : i.kind === "ASSIGNMENT" ? { kind: "ASSIGNMENT", submission: submissionBy.get(i.id) ?? null } : null,
        bookmarked: bookmarks.has(i.id),
      };
    });
    return { id: s.id, title: s.title, items, completedCount: items.filter((i) => i.progress.completed).length };
  });
  const order = curriculum.items.map((i) => i.id);

  return {
    course: { id: courseId, slug: String(course.slug), title: course.title, coverUrl: urlOf(cover, course.cover_upload_id), certificateEnabled: course.certificate_enabled },
    role: granted.enrollmentId ? "LEARNER" : "STAFF",
    enrollment: enrollment
      ? {
          id: enrollment.id,
          progressPercent: enrollment.progress_percent,
          completedItems: enrollment.completed_items,
          totalItems: order.length,
          completedAt: enrollment.completed_at?.toISOString() ?? null,
          validUntil: enrollment.valid_until?.toISOString() ?? null,
        }
      : null,
    sections,
    resumeItemId: resumeTarget(order, completed, enrollment?.last_item_id ?? null),
    certificate: certificate ? { serial: certificate.serial, issuedAt: certificate.issued_at.toISOString() } : null,
    settings: { videoCompletePercent: settings.learning.videoCompletePercent },
  };
}

/** One item's content, after the entitlement check (free previews open to anyone). */
export async function itemContent(viewer: Actor | null, itemId: string): Promise<ItemContent> {
  const granted = await requireItemAccess(viewer, itemId);
  const { item, course } = granted;
  // Only a learner with an enrollment has progress; staff and preview viewers see a clean slate.
  const userId = viewer && !granted.preview ? viewer.id : null;
  const { items } = await catalogRepo.curriculum(course.id);
  const self = items.find((i) => i.id === itemId);
  if (!self) throw notFound("Item not found");
  const nav = neighbours(items.map((i) => i.id), itemId);
  const base = {
    item: { id: item.id, kind: item.kind, title: item.title, lectureKind: item.kind === "LECTURE" ? self.lecture_kind : null, durationSeconds: item.duration_seconds, isPreview: item.is_preview, sectionId: item.section_id },
    progress: userId ? toItemProgress(await classroomRepo.progressForItem(userId, itemId), item.duration_seconds) : EMPTY_PROGRESS,
    prevItemId: nav.prev,
    nextItemId: nav.next,
  };

  if (item.kind === "QUIZ") {
    const quiz = await quizOverview(itemId, course.id, userId);
    if (!quiz) throw notFound("Item not found");
    return { kind: "QUIZ", ...base, quiz };
  }
  if (item.kind === "ASSIGNMENT") {
    const enrollment = granted.enrollmentId ? await classroomRepo.enrollment(granted.enrollmentId) : undefined;
    const assignment = await assignmentView(itemId, userId, enrollment?.created_at ?? null);
    if (!assignment) throw notFound("Item not found");
    return { kind: "ASSIGNMENT", ...base, assignment };
  }

  const [lecture, resourceRows] = await Promise.all([classroomRepo.lecture(itemId), classroomRepo.resources(itemId)]);
  if (!lecture) throw notFound("Item not found");
  const resources = await presentResources(resourceRows);
  const notesHtml = lecture.body ? renderAuthored(lecture.body) : null;
  if (lecture.lecture_kind === "VIDEO") {
    return { kind: "LECTURE", ...base, lecture: { lectureKind: "VIDEO", provider: lecture.video_provider ?? "HLS", videoStatus: lecture.video_status, notesHtml }, resources };
  }
  if (lecture.lecture_kind === "ARTICLE") return { kind: "LECTURE", ...base, lecture: { lectureKind: "ARTICLE", html: renderAuthored(lecture.body) }, resources };
  const pdf = (await loadMedia([lecture.pdf_upload_id])).get(lecture.pdf_upload_id ?? "");
  return { kind: "LECTURE", ...base, lecture: { lectureKind: "PDF", pdf: pdf ? { url: pdf.url, fileName: pdf.fileName, sizeBytes: pdf.sizeBytes } : null, notesHtml }, resources };
}

/** The item and enrollment a progress write may use, or the 409 explaining why not. */
async function writableItem(actor: Actor, itemId: string) {
  const granted = await requireItemAccess(actor, itemId);
  if (granted.preview) throw conflict("This is a free preview: enroll to track your progress", "PREVIEW");
  if (!granted.enrollmentId) throw conflict("Staff preview: progress is not recorded", "STAFF_PREVIEW");
  const lecture = granted.item.kind === "LECTURE" ? await classroomRepo.lecture(itemId) : undefined;
  return { granted, enrollmentId: granted.enrollmentId, lectureKind: lecture?.lecture_kind ?? null };
}

/** A player heartbeat. Completes the video (and maybe the course) once enough was really watched. */
export async function beat(actor: Actor, itemId: string, input: ProgressBeat): Promise<ProgressResult> {
  const { granted, enrollmentId, lectureKind } = await writableItem(actor, itemId);
  if (lectureKind !== "VIDEO") throw conflict("Only videos report playback progress", "NOT_A_VIDEO");
  const settings = await getSettings();
  const courseId = granted.course.id;
  const duration = granted.item.duration_seconds > 0 ? granted.item.duration_seconds : Math.min(MAX_BEAT_DURATION, Math.max(0, Math.round(input.durationSeconds ?? 0)));
  return withTransaction(async (trx, fx) => {
    const locked = await classroomRepo.lockEnrollment(enrollmentId, trx);
    const prev = await classroomRepo.progressForItem(actor.id, itemId, trx);
    const now = new Date();
    const next = applyBeat(
      prev
        ? { positionSeconds: prev.position_seconds, furthestSeconds: prev.furthest_seconds, watchedSeconds: prev.watched_seconds, completedAt: prev.completed_at, updatedAt: prev.updated_at }
        : { positionSeconds: 0, furthestSeconds: 0, watchedSeconds: 0, completedAt: null, updatedAt: null },
      { positionSeconds: input.positionSeconds, playedSeconds: input.playedSeconds },
      duration,
      now,
    );
    await classroomRepo.saveProgress({ userId: actor.id, itemId, courseId, position: next.positionSeconds, furthest: next.furthestSeconds, watched: next.watchedSeconds, at: now }, trx);
    let done: Awaited<ReturnType<typeof markItemComplete>> | null = null;
    if (!prev?.completed_at && videoComplete(next, duration, settings.learning.videoCompletePercent)) {
      done = await markItemComplete({ userId: actor.id, courseId, itemId }, trx, fx);
    }
    await classroomRepo.touchEnrollment(enrollmentId, itemId, trx);
    const row = await classroomRepo.progressForItem(actor.id, itemId, trx);
    return {
      progress: toItemProgress(row, duration),
      justCompleted: done?.justCompleted ?? false,
      course: done ? { progressPercent: done.rollup.progressPercent, completedAt: done.rollup.completedAt?.toISOString() ?? null } : { progressPercent: locked.progress_percent, completedAt: locked.completed_at?.toISOString() ?? null },
      certificate: done?.rollup.certificateSerial ? { serial: done.rollup.certificateSerial } : null,
    };
  });
}

/** "Mark as done" for articles and PDFs (quizzes, assignments and videos complete themselves). */
export async function complete(actor: Actor, itemId: string): Promise<ProgressResult> {
  const { granted, enrollmentId, lectureKind } = await writableItem(actor, itemId);
  if (lectureKind !== "ARTICLE" && lectureKind !== "PDF") throw conflict("This item completes by itself", "ITEM_COMPLETES_ITSELF");
  return withTransaction(async (trx, fx) => {
    await classroomRepo.lockEnrollment(enrollmentId, trx);
    const done = await markItemComplete({ userId: actor.id, courseId: granted.course.id, itemId }, trx, fx);
    await classroomRepo.touchEnrollment(enrollmentId, itemId, trx);
    const row = await classroomRepo.progressForItem(actor.id, itemId, trx);
    return {
      progress: toItemProgress(row, granted.item.duration_seconds),
      justCompleted: done.justCompleted,
      course: { progressPercent: done.rollup.progressPercent, completedAt: done.rollup.completedAt?.toISOString() ?? null },
      certificate: done.rollup.certificateSerial ? { serial: done.rollup.certificateSerial } : null,
    };
  });
}

export async function bookmark(actor: Actor, itemId: string): Promise<void> {
  const granted = await requireItemAccess(actor, itemId);
  await classroomRepo.bookmark(actor.id, itemId, granted.course.id);
}

export async function unbookmark(actor: Actor, itemId: string): Promise<void> {
  await classroomRepo.unbookmark(actor.id, itemId);
}
