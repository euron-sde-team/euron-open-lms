/** Catalog, curriculum, the classroom, assessments, certificates and community. Re-exported from index.ts. */
import type { ContentStatus, Media, Money, UserSummary } from "./index";

// ─── Enums ──────────────────────────────────────────────────────────────────

export type CourseStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export const COURSE_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "ALL_LEVELS"] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];
export type AccessMode = "FREE" | "PAID" | "SUBSCRIPTION_ONLY";
export type CourseStaffRole = "OWNER" | "EDITOR" | "GRADER";
export type ItemKind = "LECTURE" | "QUIZ" | "ASSIGNMENT";
export type LectureKind = "VIDEO" | "ARTICLE" | "PDF";
export type VideoProvider = "EVS" | "HLS" | "MP4" | "YOUTUBE";
export type VideoStatus = "PROCESSING" | "READY" | "FAILED";
export type QuestionKind = "SINGLE" | "MULTI" | "TRUE_FALSE" | "SHORT_TEXT";
export type TextMatch = "EXACT" | "CASE_INSENSITIVE" | "REGEX";
export type QuizSelection = "FIXED" | "RANDOM";
export type RevealPolicy = "AFTER_SUBMIT" | "AFTER_PASS" | "NEVER";
export type AttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "EXPIRED";
export type SubmissionStatus = "SUBMITTED" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";
export type EnrollmentSource = "FREE" | "PURCHASE" | "BUNDLE" | "SUBSCRIPTION" | "GRANT";
export type ReportTarget = "REVIEW" | "QA_THREAD" | "QA_REPLY";
export type ReportReason = "SPAM" | "HARASSMENT" | "OFF_TOPIC" | "SPOILER" | "INAPPROPRIATE" | "OTHER";

// ─── Catalog ────────────────────────────────────────────────────────────────

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  courseCount: number;
}

export interface Instructor extends UserSummary {
  bio: string | null;
  website: string | null;
}

/**
 * What the viewer can do with a course, computed by the API (domain/entitlements.ts).
 * The web app only renders it; it never decides access on its own.
 */
export type CourseAccess =
  | { state: "ENROLLED"; enrollmentId: string; progressPercent: number; completedAt: string | null; validUntil: string | null; resumeItemId: string | null }
  /** Signed in and FREE: one click enrolls. */
  | { state: "FREE" }
  /** Covered by the viewer's active plan: one click starts it. */
  | { state: "INCLUDED_IN_PLAN" }
  /** Purchasable in the viewer's currency. `subscriptionAlso`: a plan would unlock it too. */
  | { state: "PURCHASABLE"; price: Money; compareAt: Money | null; subscriptionAlso: boolean }
  /** Only through a plan. */
  | { state: "SUBSCRIPTION_REQUIRED" }
  /** Staff on this course (owner, editor or grader) or an admin: full access, no progress. */
  | { state: "STAFF" }
  /** Enrolled once, but the access lapsed (grant expired, subscription ended, refunded). */
  | { state: "LAPSED"; reason: "EXPIRED" | "REVOKED" | "SUBSCRIPTION_ENDED" | "REFUNDED"; price: Money | null }
  /** Not sold in any currency the viewer can pay in. */
  | { state: "UNAVAILABLE" }
  | { state: "SIGNED_OUT"; free: boolean; price: Money | null };

/** A row in the catalog and the cards everywhere. */
export interface CourseCard {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  level: CourseLevel;
  language: string;
  accessMode: AccessMode;
  includedInSubscription: boolean;
  instructors: UserSummary[];
  categories: { slug: string; name: string }[];
  itemCount: number;
  durationSeconds: number;
  enrollmentCount: number;
  rating: { average: number; count: number } | null;
  /** In the requested display currency; null for FREE and SUBSCRIPTION_ONLY. */
  price: Money | null;
  compareAt: Money | null;
  featured: boolean;
  publishedAt: string | null;
  /** Only when signed in. */
  viewer: { saved: boolean; enrolled: boolean; progressPercent: number | null } | null;
}

export interface CurriculumItemPublic {
  id: string;
  kind: ItemKind;
  title: string;
  lectureKind: LectureKind | null;
  durationSeconds: number;
  isPreview: boolean;
}

export interface CurriculumSectionPublic {
  id: string;
  title: string;
  items: CurriculumItemPublic[];
  durationSeconds: number;
}

/** GET /api/courses/:slug: the course landing page. */
export interface CourseDetail extends CourseCard {
  /** Learners only ever see PUBLISHED; staff previews also see DRAFT and ARCHIVED. */
  status: CourseStatus;
  /** Sanitized HTML rendered from the markdown description. */
  descriptionHtml: string;
  outcomes: string[];
  prerequisites: string[];
  certificateEnabled: boolean;
  instructors: Instructor[];
  sections: CurriculumSectionPublic[];
  counts: { lectures: number; quizzes: number; assignments: number; articles: number; pdfs: number };
  ratingBreakdown: Record<"1" | "2" | "3" | "4" | "5", number>;
  access: CourseAccess;
  /** Bundles that include this course and are on sale. */
  bundles: BundleCard[];
  updatedAt: string;
}

export interface CatalogFacets {
  categories: { slug: string; name: string; count: number }[];
  levels: Record<CourseLevel, number>;
  languages: { code: string; count: number }[];
  price: { free: number; paid: number; subscription: number };
}

export type CatalogSort = "relevance" | "popular" | "newest" | "rating" | "price_asc" | "price_desc";

export interface BundleCard {
  id: string;
  slug: string;
  title: string;
  description: string;
  coverUrl: string | null;
  courseCount: number;
  price: Money | null;
  /** What the courses would cost one by one, in the same currency. */
  separately: Money | null;
}

export interface BundleDetail extends BundleCard {
  courses: CourseCard[];
  viewerOwnsAll: boolean;
}

// ─── Classroom ──────────────────────────────────────────────────────────────

export interface ItemProgress {
  completed: boolean;
  completedAt: string | null;
  positionSeconds: number;
  /** 0..100 of the video watched (furthest point, not seeks). */
  watchedPercent: number;
}

export interface ClassroomItem extends CurriculumItemPublic {
  progress: ItemProgress;
  /** Quiz: best attempt; assignment: latest submission status. */
  status: { kind: "QUIZ"; bestPercent: number | null; passed: boolean } | { kind: "ASSIGNMENT"; submission: SubmissionStatus | null } | null;
  bookmarked: boolean;
}

export interface ClassroomSection {
  id: string;
  title: string;
  items: ClassroomItem[];
  completedCount: number;
}

/** GET /api/learn/:courseSlug: the classroom shell (curriculum + progress). */
export interface Classroom {
  course: { id: string; slug: string; title: string; coverUrl: string | null; certificateEnabled: boolean };
  role: "LEARNER" | "STAFF" | "PREVIEW";
  enrollment: { id: string; progressPercent: number; completedItems: number; totalItems: number; completedAt: string | null; validUntil: string | null } | null;
  sections: ClassroomSection[];
  resumeItemId: string | null;
  certificate: { serial: string; issuedAt: string } | null;
  settings: { videoCompletePercent: number };
}

export interface LectureResource {
  id: string;
  title: string;
  /** A signed download URL (uploads) or the external link. */
  url: string;
  external: boolean;
  fileName: string | null;
  sizeBytes: number | null;
}

/** GET /api/learn/items/:itemId: one item's content. Only after the entitlement check. */
export type ItemContent =
  | {
      kind: "LECTURE";
      item: CurriculumItemPublic & { sectionId: string };
      lecture:
        | { lectureKind: "VIDEO"; provider: VideoProvider; videoStatus: VideoStatus; notesHtml: string | null }
        | { lectureKind: "ARTICLE"; html: string }
        | { lectureKind: "PDF"; pdf: { url: string; fileName: string; sizeBytes: number | null } | null; notesHtml: string | null };
      resources: LectureResource[];
      progress: ItemProgress;
      prevItemId: string | null;
      nextItemId: string | null;
    }
  | { kind: "QUIZ"; item: CurriculumItemPublic & { sectionId: string }; quiz: QuizOverview; progress: ItemProgress; prevItemId: string | null; nextItemId: string | null }
  | { kind: "ASSIGNMENT"; item: CurriculumItemPublic & { sectionId: string }; assignment: AssignmentView; progress: ItemProgress; prevItemId: string | null; nextItemId: string | null };

/** POST /api/learn/items/:itemId/playback: how to play this video, right now. */
export type Playback =
  | {
      provider: "EVS";
      manifestUrl: string;
      thumbnailsUrl: string | null;
      posterUrl: string | null;
      /** Text to stamp over the video when the EVS policy requires a watermark. */
      watermark: string | null;
      expiresAt: string;
      resumeAt: number;
    }
  | { provider: "HLS" | "MP4"; url: string; posterUrl: string | null; watermark: string | null; resumeAt: number; expiresAt: null }
  | { provider: "YOUTUBE"; embedUrl: string; resumeAt: number; watermark: null; expiresAt: null };

/** POST /api/learn/items/:itemId/progress body (heartbeats every ~15 s and on pause/end). */
export interface ProgressBeat {
  positionSeconds: number;
  /** Seconds actually played since the last beat (the player measures it). */
  playedSeconds: number;
  durationSeconds?: number;
}

export interface ProgressResult {
  progress: ItemProgress;
  /** True only on the beat that completed this item. */
  justCompleted: boolean;
  course: { progressPercent: number; completedAt: string | null };
  /** Set once, when this beat finished the course and a certificate was issued. */
  certificate: { serial: string } | null;
}

export interface Note {
  id: string;
  itemId: string;
  itemTitle: string;
  atSeconds: number | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** One row of My Learning. */
export interface LearningEntry {
  course: CourseCard;
  enrollmentId: string;
  source: EnrollmentSource;
  progressPercent: number;
  completedItems: number;
  totalItems: number;
  completedAt: string | null;
  lastActivityAt: string | null;
  resumeItem: { id: string; title: string; kind: ItemKind } | null;
  validUntil: string | null;
  /** False when the access lapsed; the course stays listed so progress is not lost. */
  active: boolean;
  certificate: { serial: string } | null;
}

export interface LearningSummary {
  inProgress: number;
  completed: number;
  certificates: number;
  minutesThisWeek: number;
  /** Consecutive days with learning activity, ending today or yesterday. */
  streakDays: number;
}

// ─── Quizzes ────────────────────────────────────────────────────────────────

export interface QuizOverview {
  instructionsHtml: string | null;
  questionCount: number;
  totalPoints: number;
  passPercent: number;
  timeLimitSeconds: number | null;
  maxAttempts: number | null;
  attemptsUsed: number;
  reveal: RevealPolicy;
  bestPercent: number | null;
  passed: boolean;
  openAttemptId: string | null;
  attempts: QuizAttemptSummary[];
}

export interface QuizAttemptSummary {
  id: string;
  number: number;
  status: AttemptStatus;
  percent: number | null;
  passed: boolean | null;
  startedAt: string;
  submittedAt: string | null;
}

/** A question as a learner sees it during an attempt: no answer key. */
export interface AttemptQuestion {
  id: string;
  kind: QuestionKind;
  promptHtml: string;
  points: number;
  options: { id: string; text: string }[];
}

/** SINGLE / TRUE_FALSE: [optionId]; MULTI: optionIds; SHORT_TEXT: { text }. */
export type AnswerValue = { optionIds: string[] } | { text: string };

export interface QuizAttempt {
  id: string;
  quizItemId: string;
  number: number;
  status: AttemptStatus;
  startedAt: string;
  /** Server-side deadline. The client shows a countdown; the server enforces it. */
  deadlineAt: string | null;
  questions: AttemptQuestion[];
  answers: Record<string, AnswerValue>;
  result: QuizResult | null;
}

export interface QuizResult {
  scorePoints: number;
  maxPoints: number;
  percent: number;
  passed: boolean;
  submittedAt: string;
  /** Per question; `correct` and `explanationHtml` only when the reveal policy allows. */
  questions: {
    id: string;
    earnedPoints: number;
    correct: boolean;
    correctOptionIds: string[] | null;
    acceptedAnswers: string[] | null;
    explanationHtml: string | null;
  }[];
  revealed: boolean;
}

// ─── Assignments ────────────────────────────────────────────────────────────

export interface RubricCriterion {
  id: string;
  title: string;
  description: string | null;
  maxPoints: number;
}

export interface AssignmentView {
  instructionsHtml: string;
  rubric: RubricCriterion[];
  maxPoints: number;
  passPoints: number | null;
  dueAt: string | null;
  allowLate: boolean;
  accepts: { text: boolean; files: boolean; url: boolean; maxFiles: number };
  submissions: Submission[];
}

export interface Submission {
  id: string;
  version: number;
  status: SubmissionStatus;
  body: string | null;
  bodyHtml: string | null;
  url: string | null;
  files: Media[];
  isLate: boolean;
  submittedAt: string;
  review: {
    scores: Record<string, number>;
    totalPoints: number;
    feedbackHtml: string | null;
    reviewer: UserSummary | null;
    reviewedAt: string;
  } | null;
}

// ─── Certificates ───────────────────────────────────────────────────────────

export interface Certificate {
  serial: string;
  learnerName: string;
  courseTitle: string;
  courseSlug: string;
  instructorNames: string[];
  issuedAt: string;
  revoked: boolean;
  revokedAt: string | null;
  /** Owner only: a signed PDF download URL. */
  pdfUrl: string | null;
  verifyUrl: string;
  academyName: string;
}

// ─── Community ──────────────────────────────────────────────────────────────

export interface Review {
  id: string;
  author: UserSummary;
  rating: number;
  body: string | null;
  reply: { body: string; by: UserSummary | null; at: string } | null;
  createdAt: string;
  updatedAt: string;
  status: ContentStatus;
  mine: boolean;
}

export interface ReviewEligibility {
  canReview: boolean;
  reason: "OK" | "NOT_ENROLLED" | "TOO_EARLY" | "ALREADY_REVIEWED" | "SIGNED_OUT";
  /** Progress needed before reviewing, in percent. */
  minProgressPercent: number;
  mine: Review | null;
}

export interface QaThread {
  id: string;
  courseId: string;
  item: { id: string; title: string } | null;
  author: UserSummary;
  title: string;
  bodyHtml: string;
  replyCount: number;
  answered: boolean;
  status: ContentStatus;
  lastActivityAt: string;
  createdAt: string;
  mine: boolean;
}

export interface QaReply {
  id: string;
  author: UserSummary;
  bodyHtml: string;
  isStaff: boolean;
  accepted: boolean;
  status: ContentStatus;
  createdAt: string;
  mine: boolean;
}

export interface QaThreadDetail extends QaThread {
  replies: QaReply[];
  /** The viewer may mark an accepted answer (thread author or course staff). */
  canAccept: boolean;
}
