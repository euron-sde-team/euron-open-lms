/**
 * The editor's curriculum: the outline (AdminSection[] with item summaries) and one
 * item in full (AdminItem). These are staff-only shapes: they carry video refs and the
 * quiz's question ids, so only /admin routes past the course-staff check use them.
 */
import type { AdminItem, AdminItemSummary, AdminSection, RubricCriterion } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { curriculumRepo } from "../repositories/curriculum.repository";
import { loadMedia } from "./media.presenter";

/** Every section of a course with its items, in order. Two queries. */
export async function sectionsOf(courseId: string, exec: Executor = db): Promise<AdminSection[]> {
  const [sections, items] = await Promise.all([curriculumRepo.sections(courseId, exec), curriculumRepo.itemSummaries(courseId, exec)]);
  const bySection = new Map<string, AdminItemSummary[]>();
  for (const it of items) {
    const meta: AdminItemSummary["meta"] = {};
    if (it.kind === "QUIZ") meta.questions = it.selection === "RANDOM" ? Number(it.draw_count ?? 0) : Number(it.question_count ?? 0);
    if (it.kind === "ASSIGNMENT") meta.pending = Number(it.pending_count ?? 0);
    const list = bySection.get(it.section_id) ?? [];
    list.push({
      id: it.id,
      kind: it.kind,
      title: it.title,
      position: it.position,
      isPreview: it.is_preview,
      durationSeconds: it.duration_seconds,
      lectureKind: it.lecture_kind ?? null,
      videoStatus: it.lecture_kind === "VIDEO" ? (it.video_status ?? null) : null,
      meta,
    });
    bySection.set(it.section_id, list);
  }
  return sections.map((s) => ({ id: s.id, title: s.title, position: s.position, items: bySection.get(s.id) ?? [] }));
}

/** One item with its kind's settings. Undefined when the item is not in this course. */
export async function itemOf(courseId: string, itemId: string, exec: Executor = db): Promise<AdminItem | undefined> {
  const item = await curriculumRepo.item(courseId, itemId, exec);
  if (!item) return undefined;
  const base = { id: item.id, sectionId: item.section_id, title: item.title, isPreview: item.is_preview, durationSeconds: item.duration_seconds };

  if (item.kind === "QUIZ") {
    const [q, questionIds] = await Promise.all([curriculumRepo.quiz(item.id, exec), curriculumRepo.quizQuestionIds(item.id, exec)]);
    if (!q) return undefined;
    return {
      kind: "QUIZ",
      ...base,
      quiz: {
        instructions: q.instructions,
        selection: q.selection,
        drawCount: q.draw_count,
        drawTags: q.draw_tags,
        passPercent: q.pass_percent,
        timeLimitSeconds: q.time_limit_seconds,
        maxAttempts: q.max_attempts,
        shuffleQuestions: q.shuffle_questions,
        shuffleOptions: q.shuffle_options,
        reveal: q.reveal,
        questionIds,
      },
    };
  }

  if (item.kind === "ASSIGNMENT") {
    const a = await curriculumRepo.assignment(item.id, exec);
    if (!a) return undefined;
    return {
      kind: "ASSIGNMENT",
      ...base,
      assignment: {
        instructions: a.instructions,
        rubric: (Array.isArray(a.rubric) ? a.rubric : []) as unknown as RubricCriterion[],
        passPoints: a.pass_points,
        dueDays: a.due_days,
        allowLate: a.allow_late,
        acceptText: a.accept_text,
        acceptFiles: a.accept_files,
        acceptUrl: a.accept_url,
        maxFiles: a.max_files,
      },
    };
  }

  const [l, resources] = await Promise.all([curriculumRepo.lecture(item.id, exec), curriculumRepo.resources(item.id, exec)]);
  if (!l) return undefined;
  const media = await loadMedia([l.pdf_upload_id, ...resources.map((r) => r.upload_id)], exec);
  return {
    kind: "LECTURE",
    ...base,
    lecture: {
      lectureKind: l.lecture_kind,
      videoProvider: l.video_provider,
      videoRef: l.video_ref,
      videoStatus: l.video_status,
      body: l.body,
      pdf: l.pdf_upload_id ? (media.get(l.pdf_upload_id) ?? null) : null,
    },
    resources: resources.map((r) => ({ id: r.id, title: r.title, url: r.url, upload: r.upload_id ? (media.get(r.upload_id) ?? null) : null })),
  };
}
