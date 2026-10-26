/** Quizzes, assignments, reviews, Q&A and reports, and the admin grading and moderation queues. */
import type {
  AdminReport, AnswerValue, GradingDetail, GradingRow, Page, ProgressResult, QaReply, QaThread, QaThreadDetail, QuizAttempt,
  ReportReason, ReportTarget, Review, ReviewEligibility, Submission, SubmissionStatus,
} from "@open-lms/types";
import { enc, type Helpers, type PageQuery } from "./helpers";

export interface SubmitAttemptResult {
  attempt: QuizAttempt;
  /** Set when the attempt passed (justCompleted says whether this submit completed the item). */
  progress: ProgressResult | null;
}

export interface SubmissionInput {
  body?: string | null;
  url?: string | null;
  uploadIds?: string[];
}

export interface QuestionsQuery extends PageQuery {
  itemId?: string;
  q?: string;
  sort?: "recent" | "unanswered";
}

export interface GradingQuery extends PageQuery {
  status?: SubmissionStatus;
  courseId?: string;
}

export interface GradingReviewInput {
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
  scores: Record<string, number>;
  feedback?: string | null;
}

export function assessmentEndpoints(h: Helpers) {
  const { get, post, put, patch, del, pq } = h;

  const quizzes = {
    /** Start an attempt, or resume the open one. */
    start: (itemId: string) => post<QuizAttempt>(`/assessments/quizzes/${enc(itemId)}/attempts`),
    attempt: (attemptId: string) => get<QuizAttempt>(`/assessments/attempts/${enc(attemptId)}`),
    /** Autosave (merged into what is saved). */
    saveAnswers: (attemptId: string, answers: Record<string, AnswerValue>) => put<void>(`/assessments/attempts/${enc(attemptId)}/answers`, { answers }),
    submit: (attemptId: string, answers?: Record<string, AnswerValue>) => post<SubmitAttemptResult>(`/assessments/attempts/${enc(attemptId)}/submit`, answers ? { answers } : {}),
  };

  const assignments = {
    submit: (itemId: string, body: SubmissionInput) => post<Submission>(`/assessments/assignments/${enc(itemId)}/submissions`, body),
    submissions: (itemId: string) => get<Submission[]>(`/assessments/assignments/${enc(itemId)}/submissions`),
  };

  const community = {
    reviewEligibility: (courseId: string) => get<ReviewEligibility>(`/community/courses/${enc(courseId)}/review-eligibility`),
    saveReview: (courseId: string, body: { rating: number; body?: string | null }) => put<Review>(`/community/courses/${enc(courseId)}/review`, body),
    deleteReview: (courseId: string) => del<void>(`/community/courses/${enc(courseId)}/review`),
    replyToReview: (reviewId: string, body: string) => post<Review>(`/community/reviews/${enc(reviewId)}/reply`, { body }),
    questions: (courseId: string, q?: QuestionsQuery) => get<Page<QaThread>>(`/community/courses/${enc(courseId)}/questions`, pq(q)),
    ask: (courseId: string, body: { title: string; body: string; itemId?: string | null }) => post<QaThread>(`/community/courses/${enc(courseId)}/questions`, body),
    question: (threadId: string) => get<QaThreadDetail>(`/community/questions/${enc(threadId)}`),
    reply: (threadId: string, body: string) => post<QaReply>(`/community/questions/${enc(threadId)}/replies`, { body }),
    accept: (threadId: string, replyId: string | null) => post<QaThreadDetail>(`/community/questions/${enc(threadId)}/accept`, { replyId }),
    editQuestion: (threadId: string, body: { title?: string; body?: string }) => patch<QaThread>(`/community/questions/${enc(threadId)}`, body),
    deleteQuestion: (threadId: string) => del<void>(`/community/questions/${enc(threadId)}`),
    editReply: (replyId: string, body: string) => patch<QaReply>(`/community/replies/${enc(replyId)}`, { body }),
    deleteReply: (replyId: string) => del<void>(`/community/replies/${enc(replyId)}`),
    report: (body: { targetType: ReportTarget; targetId: string; reason: ReportReason; note?: string | null }) => post<{ id: string }>("/community/reports", body),
  };

  const grading = {
    list: (q?: GradingQuery) => get<Page<GradingRow>>("/admin/grading", pq(q)),
    get: (submissionId: string) => get<GradingDetail>(`/admin/grading/${enc(submissionId)}`),
    review: (submissionId: string, body: GradingReviewInput) => post<GradingDetail>(`/admin/grading/${enc(submissionId)}/review`, body),
    aiSuggestion: (submissionId: string) => post<GradingDetail>(`/admin/grading/${enc(submissionId)}/ai-suggestion`, {}),
  };

  const moderation = {
    reports: (q?: PageQuery & { status?: "OPEN" | "RESOLVED" }) => get<Page<AdminReport>>("/admin/moderation/reports", pq(q)),
    resolve: (reportId: string, body: { action: "HIDE" | "RESTORE" | "DISMISS"; note?: string | null }) => post<AdminReport>(`/admin/moderation/reports/${enc(reportId)}/resolve`, body),
  };

  return { quizzes, assignments, community, grading, moderation };
}
