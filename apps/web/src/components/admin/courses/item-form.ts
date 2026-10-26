/** The item editor's form state and the PATCH it turns into (pure). */
import type { AdminItem, LectureKind, QuizSelection, RevealPolicy, VideoProvider } from "@open-lms/types";
import type { AdminItemPatch } from "@open-lms/api-client";
import { parseTags, rubricErrors, rubricFromRows, rowsFromRubric, type RubricRow } from "./authoring-model";

export interface ItemForm {
  title: string;
  isPreview: boolean;
  minutes: string;
  seconds: string;
  lecture: { lectureKind: LectureKind; videoProvider: VideoProvider; videoRef: string; body: string } | null;
  quiz: {
    instructions: string;
    selection: QuizSelection;
    drawCount: string;
    drawTags: string;
    passPercent: string;
    timeLimitMinutes: string;
    maxAttempts: string;
    shuffleQuestions: boolean;
    shuffleOptions: boolean;
    reveal: RevealPolicy;
    questionIds: string[];
  } | null;
  assignment: {
    instructions: string;
    rubric: RubricRow[];
    passPoints: string;
    dueDays: string;
    allowLate: boolean;
    acceptText: boolean;
    acceptFiles: boolean;
    acceptUrl: boolean;
    maxFiles: string;
  } | null;
}

const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function itemToForm(item: AdminItem): ItemForm {
  const d = Math.max(0, item.durationSeconds);
  return {
    title: item.title,
    isPreview: item.isPreview,
    minutes: String(Math.floor(d / 60)),
    seconds: String(d % 60),
    lecture:
      item.kind === "LECTURE"
        ? { lectureKind: item.lecture.lectureKind, videoProvider: item.lecture.videoProvider ?? "EVS", videoRef: item.lecture.videoRef ?? "", body: item.lecture.body ?? "" }
        : null,
    quiz:
      item.kind === "QUIZ"
        ? {
            instructions: item.quiz.instructions ?? "",
            selection: item.quiz.selection,
            drawCount: str(item.quiz.drawCount),
            drawTags: item.quiz.drawTags.join(", "),
            passPercent: String(item.quiz.passPercent),
            timeLimitMinutes: item.quiz.timeLimitSeconds ? String(Math.round(item.quiz.timeLimitSeconds / 60)) : "",
            maxAttempts: str(item.quiz.maxAttempts),
            shuffleQuestions: item.quiz.shuffleQuestions,
            shuffleOptions: item.quiz.shuffleOptions,
            reveal: item.quiz.reveal,
            questionIds: item.quiz.questionIds.slice(),
          }
        : null,
    assignment:
      item.kind === "ASSIGNMENT"
        ? {
            instructions: item.assignment.instructions,
            rubric: rowsFromRubric(item.assignment.rubric),
            passPoints: str(item.assignment.passPoints),
            dueDays: str(item.assignment.dueDays),
            allowLate: item.assignment.allowLate,
            acceptText: item.assignment.acceptText,
            acceptFiles: item.assignment.acceptFiles,
            acceptUrl: item.assignment.acceptUrl,
            maxFiles: String(item.assignment.maxFiles),
          }
        : null,
  };
}

export type ItemFormErrors = Partial<Record<string, string>> & { rubricRows?: Record<number, { title?: string; maxPoints?: string }> };

const whole = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
};

export function validateItemForm(f: ItemForm): ItemFormErrors {
  const e: ItemFormErrors = {};
  if (!f.title.trim()) e.title = "Give it a title.";
  else if (f.title.length > 200) e.title = "Keep the title under 200 characters.";
  if (!whole(f.minutes || "0", 0, 6000) || !whole(f.seconds || "0", 0, 59)) e.duration = "Minutes from 0 and seconds from 0 to 59.";
  if (f.quiz) {
    if (!whole(f.quiz.passPercent, 0, 100)) e.passPercent = "A whole percentage from 0 to 100.";
    if (f.quiz.selection === "RANDOM" && !whole(f.quiz.drawCount, 1, 200)) e.drawCount = "Draw 1 to 200 questions.";
    if (f.quiz.timeLimitMinutes.trim() && !whole(f.quiz.timeLimitMinutes, 1, 1440)) e.timeLimit = "From 1 to 1440 minutes, or empty for no limit.";
    if (f.quiz.maxAttempts.trim() && !whole(f.quiz.maxAttempts, 1, 100)) e.maxAttempts = "From 1 to 100, or empty for unlimited.";
  }
  if (f.assignment) {
    const r = rubricErrors(f.assignment.rubric, f.assignment.passPoints);
    if (Object.keys(r.rows).length) e.rubricRows = r.rows;
    if (r.passPoints) e.passPoints = r.passPoints;
    if (f.assignment.dueDays.trim() && !whole(f.assignment.dueDays, 1, 365)) e.dueDays = "From 1 to 365 days, or empty for no due date.";
    if (!whole(f.assignment.maxFiles, 0, 20)) e.maxFiles = "From 0 to 20 files.";
    if (!f.assignment.acceptText && !f.assignment.acceptFiles && !f.assignment.acceptUrl) e.accept = "Accept at least one kind of submission.";
  }
  return e;
}

export const hasErrors = (e: ItemFormErrors) => Object.keys(e).length > 0;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const intOrNull = (raw: string) => (raw.trim() === "" ? null : Number(raw));

/** The PATCH for what changed (groups are sent whole once anything in them changed), plus the FIXED question order when it changed. */
export function itemPatch(base: ItemForm, next: ItemForm): { patch: AdminItemPatch; questionIds: string[] | null } {
  const patch: AdminItemPatch = {};
  if (base.title !== next.title) patch.title = next.title.trim();
  if (base.isPreview !== next.isPreview) patch.isPreview = next.isPreview;
  const dur = (f: ItemForm) => Number(f.minutes || 0) * 60 + Number(f.seconds || 0);
  if (dur(base) !== dur(next)) patch.durationSeconds = dur(next);
  if (next.lecture && !same(base.lecture, next.lecture)) {
    const l = next.lecture;
    patch.lecture = l.lectureKind === "VIDEO" ? { videoProvider: l.videoProvider, videoRef: l.videoRef.trim() || null, body: l.body || null } : { body: l.body || null };
  }
  let questionIds: string[] | null = null;
  if (next.quiz && base.quiz) {
    const { questionIds: qa, ...restA } = base.quiz;
    const { questionIds: qb, ...restB } = next.quiz;
    if (!same(restA, restB)) {
      patch.quiz = {
        instructions: restB.instructions.trim() || null,
        selection: restB.selection,
        drawCount: restB.selection === "RANDOM" ? intOrNull(restB.drawCount) : null,
        drawTags: restB.selection === "RANDOM" ? parseTags(restB.drawTags) : [],
        passPercent: Number(restB.passPercent),
        timeLimitSeconds: restB.timeLimitMinutes.trim() ? Number(restB.timeLimitMinutes) * 60 : null,
        maxAttempts: intOrNull(restB.maxAttempts),
        shuffleQuestions: restB.shuffleQuestions,
        shuffleOptions: restB.shuffleOptions,
        reveal: restB.reveal,
      };
    }
    if (!same(qa, qb)) questionIds = qb;
  }
  if (next.assignment && !same(base.assignment, next.assignment)) {
    const a = next.assignment;
    patch.assignment = {
      instructions: a.instructions,
      rubric: rubricFromRows(a.rubric),
      passPoints: intOrNull(a.passPoints),
      dueDays: intOrNull(a.dueDays),
      allowLate: a.allowLate,
      acceptText: a.acceptText,
      acceptFiles: a.acceptFiles,
      acceptUrl: a.acceptUrl,
      maxFiles: Number(a.maxFiles),
    };
  }
  return { patch, questionIds };
}
