/**
 * Quiz attempts: start (or resume), autosave, submit, read. The rules:
 *
 *   - Only learners with access take quizzes (requireItemAccess). Staff get 409
 *     STAFF_PREVIEW: an attempt would record progress for someone who is not learning.
 *     Quizzes are never free previews.
 *   - One open attempt per learner per quiz (partial unique index). Starting while one
 *     is open returns it; an open attempt past its deadline is first closed as EXPIRED,
 *     graded on what was autosaved.
 *   - max_attempts counts closed attempts (SUBMITTED and EXPIRED): 409 NO_ATTEMPTS_LEFT.
 *   - The snapshot freezes the questions with crypto randomness; grading reads only the
 *     snapshot, so answers to foreign question or option ids earn nothing.
 *   - The deadline is enforced here, not by the client timer: autosave past it is 409
 *     ATTEMPT_OVERDUE; a submit within the grace (domain/quiz.ts isOverdue) is accepted,
 *     one after it is closed as EXPIRED on the autosaved answers.
 *   - Closing is a conditional UPDATE on status = 'IN_PROGRESS' under a row lock, so a
 *     double submit grades once; the second request gets the graded attempt.
 *   - The first pass completes the item (services/progress.service.ts) in the same
 *     transaction, which may finish the course and issue the certificate.
 */
import type { AnswerValue, ProgressResult, QuizAttempt, QuizOverview } from "@open-lms/types";
import { randomInt } from "node:crypto";
import type { Transaction } from "kysely";
import { requireActive, type Actor } from "../core/context";
import { withTransaction, type Effects } from "../core/effects";
import { conflict, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db, type Executor } from "../db/kysely";
import type { DB } from "../db/types";
import { renderAuthored } from "../domain/markdown";
import { buildSnapshot, cleanAnswers, grade, isOverdue } from "../domain/quiz";
import { presentAttempt, toAttemptSummary } from "../presenters/attempt.presenter";
import { answersOf, attemptRepo, isUniqueViolation, snapshotOf, type AttemptRow } from "../repositories/attempt.repository";
import { quizRepo, type QuizRow } from "../repositories/quiz.repository";
import { requireItemAccess } from "./access.service";
import { markItemComplete } from "./progress.service";

/** Uniform in [0, 1) from the OS CSPRNG: question and option order must not be predictable. */
const cryptoRandom = () => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000;

export interface SubmitResult {
  attempt: QuizAttempt;
  /** Set when this submit passed the quiz (completion is idempotent: justCompleted says whether it was new). */
  progress: ProgressResult | null;
}

/** The quiz behind an item the learner may take, or the reason they may not. */
async function requireQuizTaker(actor: Actor, itemId: string): Promise<{ quiz: QuizRow; courseId: string }> {
  const access = await requireItemAccess(actor, itemId);
  if (access.item.kind !== "QUIZ") throw notFound("Quiz not found");
  if (access.decision.via === "STAFF") throw conflict("Course staff preview quizzes in the editor; attempts are for learners", "STAFF_PREVIEW");
  const quiz = await quizRepo.findByItem(itemId);
  if (!quiz) throw notFound("Quiz not found");
  return { quiz, courseId: access.course.id };
}

/** An attempt owned by the actor (anyone else's is 404), with its quiz, after the access check. */
async function requireOwnAttempt(actor: Actor, attemptId: string): Promise<{ row: AttemptRow; quiz: QuizRow; courseId: string }> {
  const row = await attemptRepo.findById(attemptId);
  if (!row || row.user_id !== actor.id) throw notFound("Attempt not found");
  const { quiz, courseId } = await requireQuizTaker(actor, row.quiz_item_id);
  return { row, quiz, courseId };
}

function attemptsLeft(quiz: QuizRow, closed: number): number | null {
  return quiz.max_attempts === null ? null : Math.max(0, quiz.max_attempts - closed);
}

async function progressResult(userId: string, itemId: string, r: Awaited<ReturnType<typeof markItemComplete>>, exec: Executor): Promise<ProgressResult> {
  const p = await exec.selectFrom("item_progress").select(["completed_at", "position_seconds"]).where("user_id", "=", userId).where("item_id", "=", itemId).executeTakeFirst();
  return {
    progress: { completed: true, completedAt: p?.completed_at?.toISOString() ?? null, positionSeconds: p?.position_seconds ?? 0, watchedPercent: 0 },
    justCompleted: r.justCompleted,
    course: { progressPercent: r.rollup.progressPercent, completedAt: r.rollup.completedAt?.toISOString() ?? null },
    certificate: r.rollup.certificateSerial ? { serial: r.rollup.certificateSerial } : null,
  };
}

/**
 * Grade and close a locked, open attempt. A pass completes the item. Returns null when
 * the attempt was closed by someone else in the meantime (the conditional UPDATE lost).
 */
async function closeAndGrade(
  trx: Transaction<DB>,
  fx: Effects,
  row: AttemptRow,
  quiz: QuizRow,
  courseId: string,
  answers: Record<string, AnswerValue>,
  status: "SUBMITTED" | "EXPIRED",
): Promise<{ row: AttemptRow; progress: ProgressResult | null } | null> {
  const graded = grade(snapshotOf(row), answers, quiz.pass_percent);
  const closed = await attemptRepo.close(row.id, { status, answers, scorePoints: graded.scorePoints, percent: graded.percent, passed: graded.passed, submittedAt: new Date() }, trx);
  if (!closed) return null;
  let progress: ProgressResult | null = null;
  if (graded.passed) {
    const r = await markItemComplete({ userId: row.user_id, courseId, itemId: row.quiz_item_id }, trx, fx);
    progress = await progressResult(row.user_id, row.quiz_item_id, r, trx);
  }
  return { row: closed, progress };
}

/** Close an overdue open attempt as EXPIRED on its autosaved answers (no-op if already closed). */
async function expireAttempt(attemptId: string, quiz: QuizRow, courseId: string): Promise<AttemptRow | undefined> {
  return withTransaction(async (trx, fx) => {
    const locked = await attemptRepo.lock(attemptId, trx);
    if (!locked) return undefined;
    if (locked.status !== "IN_PROGRESS") return locked;
    const r = await closeAndGrade(trx, fx, locked, quiz, courseId, cleanAnswers(snapshotOf(locked), answersOf(locked)), "EXPIRED");
    return r?.row ?? (await attemptRepo.findById(attemptId, trx));
  });
}

/** POST /assessments/quizzes/:itemId/attempts: resume the open attempt or start the next one. */
export async function startAttempt(actor: Actor, itemId: string): Promise<QuizAttempt> {
  requireActive(actor);
  const { quiz, courseId } = await requireQuizTaker(actor, itemId);
  // Two concurrent starts both try number = max + 1; one loses on a unique constraint and
  // the retry finds (and returns) the winner's open attempt.
  for (let tries = 0; tries < 3; tries++) {
    try {
      return await startOnce(actor, quiz, courseId);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  const open = await attemptRepo.findOpen(itemId, actor.id);
  if (!open) throw conflict("Could not start the attempt, try again", "ATTEMPT_CONFLICT");
  return presentAttempt(open, quiz, null);
}

async function startOnce(actor: Actor, quiz: QuizRow, courseId: string): Promise<QuizAttempt> {
  const open = await attemptRepo.findOpen(quiz.item_id, actor.id);
  if (open) {
    if (!isOverdue(open.deadline_at, new Date())) return presentAttempt(open, quiz, null);
    await expireAttempt(open.id, quiz, courseId);
  }
  return withTransaction(async (trx) => {
    const { maxNumber, closed } = await attemptRepo.counts(quiz.item_id, actor.id, trx);
    if (quiz.max_attempts !== null && closed >= quiz.max_attempts) throw conflict("You have used every attempt for this quiz", "NO_ATTEMPTS_LEFT", { maxAttempts: quiz.max_attempts });
    const bank = await quizRepo.bankFor(quiz, courseId, trx);
    if (!bank.length) throw conflict("This quiz has no questions yet", "QUIZ_EMPTY");
    const snapshot = buildSnapshot(bank, { selection: quiz.selection, drawCount: quiz.draw_count, shuffleQuestions: quiz.shuffle_questions, shuffleOptions: quiz.shuffle_options }, cryptoRandom);
    const startedAt = new Date();
    const row = await attemptRepo.insert(
      {
        id: newId(),
        quiz_item_id: quiz.item_id,
        course_id: courseId,
        user_id: actor.id,
        number: maxNumber + 1,
        status: "IN_PROGRESS",
        snapshot: JSON.stringify(snapshot),
        answers: "{}",
        max_points: snapshot.reduce((a, q) => a + q.points, 0),
        started_at: startedAt,
        deadline_at: quiz.time_limit_seconds ? new Date(startedAt.getTime() + quiz.time_limit_seconds * 1000) : null,
      },
      trx,
    );
    return presentAttempt(row, quiz, attemptsLeft(quiz, closed));
  });
}

/** GET /assessments/attempts/:attemptId (own only). An overdue open attempt is closed first. */
export async function getAttempt(actor: Actor, attemptId: string): Promise<QuizAttempt> {
  const own = await requireOwnAttempt(actor, attemptId);
  let row = own.row;
  if (row.status === "IN_PROGRESS" && isOverdue(row.deadline_at, new Date())) row = (await expireAttempt(row.id, own.quiz, own.courseId)) ?? row;
  const { closed } = await attemptRepo.counts(row.quiz_item_id, actor.id);
  return presentAttempt(row, own.quiz, attemptsLeft(own.quiz, closed));
}

/** PUT /assessments/attempts/:attemptId/answers: autosave while open and on time. */
export async function saveAnswers(actor: Actor, attemptId: string, raw: Record<string, AnswerValue>): Promise<void> {
  requireActive(actor);
  await requireOwnAttempt(actor, attemptId);
  await withTransaction(async (trx) => {
    const locked = await attemptRepo.lock(attemptId, trx);
    if (!locked || locked.status !== "IN_PROGRESS") throw conflict("This attempt is already submitted", "ATTEMPT_CLOSED");
    if (isOverdue(locked.deadline_at, new Date())) throw conflict("Time is up for this attempt", "ATTEMPT_OVERDUE");
    const merged = cleanAnswers(snapshotOf(locked), { ...answersOf(locked), ...raw });
    if (!(await attemptRepo.saveAnswers(attemptId, merged, trx))) throw conflict("This attempt is already submitted", "ATTEMPT_CLOSED");
  });
}

/** POST /assessments/attempts/:attemptId/submit: grade once; a repeat gets the graded attempt. */
export async function submitAttempt(actor: Actor, attemptId: string, raw: Record<string, AnswerValue> | undefined): Promise<SubmitResult> {
  requireActive(actor);
  const { quiz, courseId } = await requireOwnAttempt(actor, attemptId);
  return withTransaction(async (trx, fx) => {
    const locked = await attemptRepo.lock(attemptId, trx);
    if (!locked) throw notFound("Attempt not found");
    let row = locked;
    let progress: ProgressResult | null = null;
    if (locked.status === "IN_PROGRESS") {
      const overdue = isOverdue(locked.deadline_at, new Date());
      // Past the grace the timer is authoritative: only what was autosaved in time counts.
      const answers = cleanAnswers(snapshotOf(locked), overdue ? answersOf(locked) : { ...answersOf(locked), ...(raw ?? {}) });
      const r = await closeAndGrade(trx, fx, locked, quiz, courseId, answers, overdue ? "EXPIRED" : "SUBMITTED");
      if (!r) throw conflict("This attempt is already submitted", "ATTEMPT_CLOSED");
      row = r.row;
      progress = r.progress;
    }
    const { closed } = await attemptRepo.counts(row.quiz_item_id, actor.id, trx);
    return { attempt: presentAttempt(row, quiz, attemptsLeft(quiz, closed)), progress };
  });
}

/**
 * The quiz card inside the classroom (ItemContent.quiz), for the learning build's
 * GET /learn/items/:itemId. `userId` null (staff) shows the settings without attempts.
 * Never includes the answer key.
 */
export async function quizOverview(quizItemId: string, courseId: string, userId: string | null, exec: Executor = db): Promise<QuizOverview | null> {
  const quiz = await quizRepo.findByItem(quizItemId, exec);
  if (!quiz) return null;
  const [bank, attempts] = await Promise.all([quizRepo.bankFor(quiz, courseId, exec), userId ? attemptRepo.listFor(quizItemId, userId, exec) : Promise.resolve([] as AttemptRow[])]);
  const questionCount = quiz.selection === "RANDOM" ? Math.min(bank.length, quiz.draw_count ?? bank.length) : bank.length;
  const bankPoints = bank.reduce((a, q) => a + q.points, 0);
  const totalPoints = quiz.selection === "RANDOM" && bank.length ? Math.round((bankPoints / bank.length) * questionCount) : bankPoints;
  const closed = attempts.filter((a) => a.status !== "IN_PROGRESS");
  const percents = closed.map((a) => a.percent ?? 0);
  return {
    instructionsHtml: quiz.instructions ? renderAuthored(quiz.instructions) : null,
    questionCount,
    totalPoints,
    passPercent: quiz.pass_percent,
    timeLimitSeconds: quiz.time_limit_seconds,
    maxAttempts: quiz.max_attempts,
    attemptsUsed: closed.length,
    reveal: quiz.reveal,
    bestPercent: percents.length ? Math.max(...percents) : null,
    passed: closed.some((a) => a.passed === true),
    openAttemptId: attempts.find((a) => a.status === "IN_PROGRESS")?.id ?? null,
    attempts: attempts.map(toAttemptSummary),
  };
}
