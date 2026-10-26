"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Flag, Timer, X } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import type { AttemptQuestion, ItemContent, QuizAttempt, QuizOverview } from "@open-lms/types";
import { Badge, Button, Input, cn, toast } from "@open-lms/ui";
import { api } from "@/lib/api";
import { countdownLabel, initQuizState, isEmptyAnswer, paletteStatus, pendingAnswers, quizReducer, secondsLeft, shouldAutoSubmit, unansweredIds, type QuizRunState } from "@/lib/classroom/quiz-state";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { formatDuration } from "@/lib/duration";
import { useClassroom } from "./classroom-context";
import { useApplyProgress } from "./use-progress";

type QuizContent = Extract<ItemContent, { kind: "QUIZ" }>;
type View = { screen: "overview" } | { screen: "running"; attempt: QuizAttempt } | { screen: "result"; attempt: QuizAttempt };

const dateFmt = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export function attemptsLeft(quiz: Pick<QuizOverview, "maxAttempts" | "attemptsUsed">): number | null {
  return quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - quiz.attemptsUsed);
}

export function QuizRunner({ content }: { content: QuizContent }) {
  const qc = useQueryClient();
  const { slug } = useClassroom();
  const itemId = content.item.id;
  const quiz = content.quiz;
  const [view, setView] = useState<View>({ screen: "overview" });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.item(itemId) });
    void qc.invalidateQueries({ queryKey: qk.classroom(slug) });
  }, [qc, itemId, slug]);

  const start = useMutation({
    mutationFn: () => api().quizzes.start(itemId),
    meta: { silent: true },
    onSuccess: (attempt) => setView(attempt.status === "IN_PROGRESS" ? { screen: "running", attempt } : { screen: "result", attempt }),
    onError: (e) => {
      toast.error({ title: errorMessage(e) });
      if (isApiError(e) && e.code === "NO_ATTEMPTS_LEFT") refresh();
    },
  });
  const openAttempt = useMutation({
    mutationFn: (id: string) => api().quizzes.attempt(id),
    onSuccess: (attempt) => setView(attempt.status === "IN_PROGRESS" ? { screen: "running", attempt } : { screen: "result", attempt }),
  });

  /** The attempt ended on the server (submitted elsewhere, or overdue): show what it became. */
  const closed = useCallback(
    async (attemptId: string, e: unknown) => {
      refresh();
      try {
        const attempt = await api().quizzes.attempt(attemptId);
        if (attempt.result) {
          toast.info({ title: errorMessage(e) });
          setView({ screen: "result", attempt });
          return;
        }
      } catch {
        /* fall through to the overview */
      }
      toast.error({ title: errorMessage(e) });
      setView({ screen: "overview" });
    },
    [refresh],
  );

  if (view.screen === "running") {
    return (
      <AttemptRunner
        attempt={view.attempt}
        onSubmitted={(attempt) => {
          refresh();
          setView({ screen: "result", attempt });
        }}
        onClosed={closed}
        onLeave={() => {
          refresh();
          setView({ screen: "overview" });
        }}
      />
    );
  }
  if (view.screen === "result") {
    const left = attemptsLeft(quiz);
    return (
      <QuizResultView
        attempt={view.attempt}
        passPercent={quiz.passPercent}
        reveal={quiz.reveal}
        canRetake={(left === null || left > 0) && !quiz.openAttemptId}
        retaking={start.isPending}
        onRetake={() => start.mutate()}
        onBack={() => setView({ screen: "overview" })}
      />
    );
  }

  const left = attemptsLeft(quiz);
  const facts = [
    `${quiz.questionCount} ${quiz.questionCount === 1 ? "question" : "questions"}`,
    `${quiz.totalPoints} points`,
    `Pass mark ${quiz.passPercent}%`,
    quiz.timeLimitSeconds ? `${formatDuration(quiz.timeLimitSeconds)} time limit` : "No time limit",
    quiz.maxAttempts ? `${quiz.attemptsUsed} of ${quiz.maxAttempts} attempts used` : quiz.attemptsUsed ? `${quiz.attemptsUsed} ${quiz.attemptsUsed === 1 ? "attempt" : "attempts"} so far` : null,
  ].filter(Boolean);

  return (
    <section className="rounded-card bg-card px-5 py-6 shadow-card sm:px-8 sm:py-8" data-testid="quiz-overview">
      <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-primary">Quiz</p>
      <p className="mt-2 text-[13px] text-muted-foreground">{facts.join(" · ")}</p>
      {quiz.bestPercent !== null ? (
        <p className="mt-4 flex items-baseline gap-3">
          <span className="font-display text-[34px] font-semibold tabular-nums tracking-[-0.02em]">{Math.round(quiz.bestPercent)}%</span>
          <span className="text-[14px] text-muted-foreground">best score</span>
          {quiz.passed ? <Badge tone="success">Passed</Badge> : null}
        </p>
      ) : null}
      {quiz.instructionsHtml ? <div className="lms-prose mt-5 max-w-[680px]" dangerouslySetInnerHTML={{ __html: quiz.instructionsHtml }} /> : null}
      {quiz.timeLimitSeconds ? <p className="mt-4 text-[13.5px] text-muted-foreground">The timer starts when you begin and keeps running if you leave. Answers save as you go and are submitted when time runs out.</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {quiz.openAttemptId ? (
          <Button onClick={() => start.mutate()} loading={start.isPending} data-testid="quiz-resume">
            Resume attempt
          </Button>
        ) : left === 0 ? (
          <p className="text-[14px] font-medium text-muted-foreground" data-testid="quiz-no-attempts">
            You have used every attempt for this quiz.
          </p>
        ) : (
          <Button onClick={() => start.mutate()} loading={start.isPending} data-testid="quiz-start">
            {quiz.attemptsUsed ? "Try again" : "Start quiz"}
          </Button>
        )}
        {left !== null && left > 0 ? <span className="text-[13px] text-muted-foreground">{left === 1 ? "1 attempt left" : `${left} attempts left`}</span> : null}
      </div>

      {quiz.attempts.length ? (
        <div className="mt-8">
          <h3 className="text-[13px] font-semibold text-muted-foreground">Previous attempts</h3>
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {quiz.attempts.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={a.status === "IN_PROGRESS" || openAttempt.isPending}
                  onClick={() => openAttempt.mutate(a.id)}
                  className="flex w-full items-center gap-3 py-3 text-left text-[14px] hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                  data-testid="quiz-attempt-row"
                >
                  <span className="w-24 shrink-0 font-medium">Attempt {a.number}</span>
                  <span className="flex-1 text-muted-foreground">{a.submittedAt ? dateFmt(a.submittedAt) : dateFmt(a.startedAt)}</span>
                  <span className="tabular-nums">{a.status === "IN_PROGRESS" ? "In progress" : a.status === "EXPIRED" && a.percent === null ? "Expired" : a.percent !== null ? `${Math.round(a.percent)}%` : ""}</span>
                  {a.passed ? <Badge tone="success">Passed</Badge> : a.passed === false ? <Badge tone="neutral">Not passed</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const SAVE_DELAY = 700;

function AttemptRunner({ attempt, onSubmitted, onClosed, onLeave }: { attempt: QuizAttempt; onSubmitted: (a: QuizAttempt) => void; onClosed: (attemptId: string, e: unknown) => void; onLeave: () => void }) {
  const apply = useApplyProgress();
  const [state, dispatch] = useReducer(quizReducer, attempt, initQuizState);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const questions = attempt.questions;
  const q = questions[state.index];

  // Autosave the dirty answers, debounced.
  const dirtyKey = Object.keys(state.dirty).sort().join(",") + JSON.stringify(pendingAnswers(state));
  useEffect(() => {
    if (!Object.keys(state.dirty).length || submitted.current) return;
    const id = window.setTimeout(() => {
      const batch = pendingAnswers(stateRef.current);
      setSaving("saving");
      api()
        .quizzes.saveAnswers(attempt.id, batch)
        .then(() => {
          dispatch({ type: "saved", saved: batch });
          setSaving("saved");
        })
        .catch((e: unknown) => {
          if (isApiError(e) && (e.code === "ATTEMPT_CLOSED" || e.code === "ATTEMPT_OVERDUE")) {
            if (!submitted.current) {
              submitted.current = true;
              onClosed(attempt.id, e);
            }
            return;
          }
          setSaving("error");
        });
    }, SAVE_DELAY);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyKey]);

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    setSubmitting(true);
    try {
      const r = await api().quizzes.submit(attempt.id, stateRef.current.answers);
      if (r.progress) apply(attempt.quizItemId, r.progress);
      onSubmitted(r.attempt);
    } catch (e) {
      if (isApiError(e) && (e.code === "ATTEMPT_CLOSED" || e.code === "ATTEMPT_OVERDUE")) {
        onClosed(attempt.id, e);
        return;
      }
      submitted.current = false;
      setSubmitting(false);
      toast.error({ title: errorMessage(e) });
    }
  }, [apply, attempt.id, attempt.quizItemId, onClosed, onSubmitted]);

  // The server deadline: a visible countdown, and an automatic submit at zero.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!attempt.deadlineAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [attempt.deadlineAt]);
  useEffect(() => {
    if (shouldAutoSubmit(attempt.deadlineAt, now, { submitting, submitted: submitted.current })) {
      toast.info({ title: "Time is up. Your answers were submitted." });
      void submit();
    }
  }, [now, attempt.deadlineAt, submitting, submit]);
  const left = secondsLeft(attempt.deadlineAt, now);

  // Keyboard: number keys pick options, Enter moves on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.metaKey || e.ctrlKey || stateRef.current.screen !== "answering") return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text"));
      const current = questions[stateRef.current.index];
      if (!current) return;
      if (!typing && /^[1-9]$/.test(e.key) && current.kind !== "SHORT_TEXT") {
        const opt = current.options[Number(e.key) - 1];
        if (opt) {
          e.preventDefault();
          dispatch({ type: "select", question: current, optionId: opt.id });
        }
      } else if (e.key === "Enter" && (!t || t.tagName !== "BUTTON" || /^(radio|checkbox)$/.test(t.getAttribute("role") ?? ""))) {
        e.preventDefault();
        dispatch({ type: "next" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [questions]);

  const unanswered = unansweredIds(state);

  return (
    <section className="rounded-card bg-card shadow-card" data-testid="quiz-runner" aria-label={`Quiz attempt ${attempt.number}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3 sm:px-8">
        <p className="text-[13px] font-medium text-muted-foreground">
          Attempt {attempt.number} · {state.screen === "review" ? "Review" : `Question ${state.index + 1} of ${questions.length}`}
        </p>
        <span className="text-[12.5px] text-subtle-foreground" aria-live="polite">
          {saving === "saving" ? "Saving" : saving === "saved" ? "Saved" : saving === "error" ? "Not saved yet, retrying on the next change" : ""}
        </span>
        <div className="flex-1" />
        {left !== null ? (
          <p className={cn("flex items-center gap-1.5 text-[14px] font-semibold tabular-nums", left <= 60 ? "text-danger" : "text-foreground")} role="timer" aria-label={`Time left ${countdownLabel(left)}`} data-testid="quiz-timer">
            <Timer className="size-4" aria-hidden /> {countdownLabel(left)}
          </p>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onLeave}>
          Save and leave
        </Button>
      </div>

      <div className="grid gap-0 md:grid-cols-[1fr_200px]">
        <div className="min-w-0 px-5 py-6 sm:px-8">
          {state.screen === "answering" && q ? (
            <QuestionScreen
              question={q}
              index={state.index}
              state={state}
              dispatch={dispatch}
              last={state.index === questions.length - 1}
            />
          ) : (
            <ReviewScreen questions={questions} state={state} unanswered={unanswered.length} onJump={(i) => dispatch({ type: "goto", index: i })} onSubmit={() => void submit()} submitting={submitting} />
          )}
        </div>
        <Palette questions={questions} state={state} onJump={(i) => dispatch({ type: "goto", index: i })} onReview={() => dispatch({ type: "review" })} />
      </div>
    </section>
  );
}

function QuestionScreen({ question, index, state, dispatch, last }: { question: AttemptQuestion; index: number; state: QuizRunState; dispatch: React.Dispatch<Parameters<typeof quizReducer>[1]>; last: boolean }) {
  const answer = state.answers[question.id];
  const selected = answer && "optionIds" in answer ? answer.optionIds : [];
  const flagged = !!state.flagged[question.id];
  const multi = question.kind === "MULTI";
  return (
    <div data-testid="quiz-question">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] font-semibold text-muted-foreground">
          {index + 1}. {question.points} {question.points === 1 ? "point" : "points"}
          {multi ? " · Choose all that apply" : ""}
        </p>
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "toggleFlag", questionId: question.id })} aria-pressed={flagged} data-testid="quiz-flag">
          <Flag className={cn(flagged && "fill-current text-warning")} /> {flagged ? "Flagged" : "Flag for review"}
        </Button>
      </div>
      <div className="lms-prose mt-2 text-[16px]" dangerouslySetInnerHTML={{ __html: question.promptHtml }} />

      {question.kind === "SHORT_TEXT" ? (
        <div className="mt-5 max-w-md">
          <label htmlFor={`a-${question.id}`} className="sr-only">
            Your answer
          </label>
          <Input
            id={`a-${question.id}`}
            autoFocus
            value={answer && "text" in answer ? answer.text : ""}
            onChange={(e) => dispatch({ type: "text", questionId: question.id, text: e.target.value })}
            placeholder="Type your answer"
            data-testid="quiz-text-answer"
          />
        </div>
      ) : (
        <div role={multi ? "group" : "radiogroup"} aria-label="Options" className="mt-5 divide-y divide-border border-y border-border">
          {question.options.map((o, i) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => dispatch({ type: "select", question, optionId: o.id })}
                className={cn("flex w-full items-center gap-3 px-2 py-3 text-left text-[15px] transition-colors", on ? "bg-primary/10" : "hover:bg-muted/60")}
                data-testid="quiz-option"
              >
                <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center border-2", multi ? "rounded-[5px]" : "rounded-full", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                  {on ? multi ? <Check className="size-3.5" /> : <span className="size-2 rounded-full bg-primary-foreground" /> : null}
                </span>
                <span className="flex-1">{o.text}</span>
                <kbd className="hidden text-[11.5px] text-subtle-foreground sm:inline">{i < 9 ? i + 1 : ""}</kbd>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2">
        <Button variant="outline" onClick={() => dispatch({ type: "prev" })} disabled={index === 0}>
          <ChevronLeft /> Previous
        </Button>
        <Button variant={last ? "primary" : "outline"} onClick={() => dispatch({ type: "next" })} data-testid="quiz-next">
          {last ? "Review answers" : "Next"} {last ? null : <ChevronRight />}
        </Button>
        {!isEmptyAnswer(answer) ? (
          <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "clear", questionId: question.id })}>
            Clear answer
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ReviewScreen({ questions, state, unanswered, onJump, onSubmit, submitting }: { questions: AttemptQuestion[]; state: QuizRunState; unanswered: number; onJump: (i: number) => void; onSubmit: () => void; submitting: boolean }) {
  return (
    <div data-testid="quiz-review">
      <h3 className="font-display text-[20px] font-semibold tracking-[-0.01em]">Review your answers</h3>
      {unanswered > 0 ? (
        <p className="mt-2 flex items-center gap-2 text-[14px] text-warning-soft-foreground" role="alert">
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          {unanswered === 1 ? "1 question is unanswered." : `${unanswered} questions are unanswered.`} Unanswered questions score zero.
        </p>
      ) : (
        <p className="mt-2 text-[14px] text-muted-foreground">Every question has an answer.</p>
      )}
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {questions.map((q, i) => {
          const s = paletteStatus(state, q.id);
          return (
            <li key={q.id}>
              <button type="button" onClick={() => onJump(i)} className="flex w-full items-center gap-3 py-2.5 text-left text-[14px] hover:bg-muted/50">
                <span className="w-8 shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="line-clamp-1 flex-1">{plainText(q.promptHtml)}</span>
                <span className={cn("shrink-0 text-[12.5px] font-medium", s === "unanswered" ? "text-warning-soft-foreground" : s === "flagged" ? "text-warning-soft-foreground" : "text-muted-foreground")}>
                  {s === "answered" ? "Answered" : s === "flagged" ? (isEmptyAnswer(state.answers[q.id]) ? "Flagged, unanswered" : "Flagged") : "Unanswered"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex items-center gap-2">
        <Button onClick={onSubmit} loading={submitting} data-testid="quiz-submit">
          Submit answers
        </Button>
        <Button variant="ghost" onClick={() => onJump(state.index)}>
          Keep answering
        </Button>
      </div>
    </div>
  );
}

/** A prompt as plain text for one-line previews (rendered as text, never as HTML). */
function plainText(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function Palette({ questions, state, onJump, onReview }: { questions: AttemptQuestion[]; state: QuizRunState; onJump: (i: number) => void; onReview: () => void }) {
  return (
    <aside className="border-t border-border px-5 py-5 md:border-l md:border-t-0 md:px-4" aria-label="Questions">
      <p className="text-[12.5px] font-semibold text-muted-foreground">Questions</p>
      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="quiz-palette">
        {questions.map((q, i) => {
          const s = paletteStatus(state, q.id);
          const current = state.screen === "answering" && state.index === i;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => onJump(i)}
              aria-current={current ? "step" : undefined}
              aria-label={`Question ${i + 1}, ${s}`}
              data-status={s}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-[10px] text-[13px] font-semibold tabular-nums transition-colors",
                s === "answered" ? "bg-ink text-ink-foreground" : "border border-input text-foreground hover:bg-muted",
                s === "flagged" && "border-warning bg-warning-soft text-warning-soft-foreground",
                current && "ring-2 ring-ring ring-offset-2 ring-offset-card",
              )}
            >
              {i + 1}
              {s === "flagged" ? <Flag className="absolute -right-1 -top-1 size-3 fill-current text-warning" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">Dark: answered. Outlined: not yet. Amber: flagged.</p>
      <Button variant="outline" size="sm" block className="mt-4" onClick={onReview}>
        Review and submit
      </Button>
    </aside>
  );
}

function QuizResultView({ attempt, passPercent, reveal, canRetake, retaking, onRetake, onBack }: { attempt: QuizAttempt; passPercent: number; reveal: QuizOverview["reveal"]; canRetake: boolean; retaking: boolean; onRetake: () => void; onBack: () => void }) {
  const r = attempt.result;
  if (!r) {
    return (
      <section className="rounded-card bg-card px-5 py-8 shadow-card sm:px-8">
        <p className="font-semibold">This attempt ended without a score.</p>
        <Button variant="outline" className="mt-4" onClick={onBack}>
          Back to the quiz
        </Button>
      </section>
    );
  }
  const byId = new Map(r.questions.map((x) => [x.id, x]));
  return (
    <section className="rounded-card bg-card px-5 py-6 shadow-card sm:px-8 sm:py-8" data-testid="quiz-result" aria-live="polite">
      <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-primary">Attempt {attempt.number} result</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-display text-[48px] font-semibold leading-none tabular-nums tracking-[-0.03em]">{Math.round(r.percent)}%</span>
        <Badge tone={r.passed ? "success" : "neutral"} size="md" data-testid="quiz-result-status">
          {r.passed ? "Passed" : "Not passed"}
        </Badge>
      </div>
      <p className="mt-2 text-[14px] text-muted-foreground">
        {r.scorePoints} of {r.maxPoints} points · Pass mark {passPercent}%
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {canRetake ? (
          <Button onClick={onRetake} loading={retaking} variant={r.passed ? "outline" : "primary"} data-testid="quiz-retake">
            Retake quiz
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onBack}>
          Back to the quiz
        </Button>
      </div>

      {r.revealed ? (
        <ol className="mt-8 divide-y divide-border border-y border-border">
          {attempt.questions.map((q, i) => {
            const res = byId.get(q.id);
            const answer = attempt.answers[q.id];
            const mine = answer && "optionIds" in answer ? answer.optionIds : [];
            return (
              <li key={q.id} className="py-5">
                <div className="flex items-start gap-3">
                  {res?.correct ? <Check className="mt-1 size-4 shrink-0 text-success" aria-label="Correct" /> : <X className="mt-1 size-4 shrink-0 text-danger" aria-label="Incorrect" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] text-muted-foreground">
                      Question {i + 1} · {res?.earnedPoints ?? 0} of {q.points} {q.points === 1 ? "point" : "points"}
                    </p>
                    <div className="lms-prose mt-1" dangerouslySetInnerHTML={{ __html: q.promptHtml }} />
                    {q.kind === "SHORT_TEXT" ? (
                      <p className="mt-2 text-[14px]">
                        <span className="text-muted-foreground">Your answer: </span>
                        {answer && "text" in answer && answer.text ? answer.text : "No answer"}
                        {res?.acceptedAnswers?.length ? <span className="block text-muted-foreground">Accepted: {res.acceptedAnswers.join(", ")}</span> : null}
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-[14px]">
                        {q.options.map((o) => {
                          const correct = res?.correctOptionIds?.includes(o.id);
                          const picked = mine.includes(o.id);
                          return (
                            <li key={o.id} className={cn("flex items-center gap-2", correct ? "font-medium text-success" : picked ? "text-danger" : "text-muted-foreground")}>
                              <span className="w-28 shrink-0 text-[12px]">{correct && picked ? "Your answer, correct" : correct ? "Correct answer" : picked ? "Your answer" : ""}</span>
                              {o.text}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {res?.explanationHtml ? <div className="lms-prose mt-3 border-l-2 border-brand pl-3 text-[14px]" dangerouslySetInnerHTML={{ __html: res.explanationHtml }} /> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-8 border-t border-border pt-5 text-[14px] text-muted-foreground">{reveal === "AFTER_PASS" && !r.passed ? "Answers and explanations appear once you pass." : "The instructor keeps the answers to this quiz hidden."}</p>
      )}
    </section>
  );
}
