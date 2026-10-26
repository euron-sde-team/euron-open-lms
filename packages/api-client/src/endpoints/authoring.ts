/**
 * Authoring endpoints: the /admin course editor (courses, curriculum, question bank,
 * prices, staff, learners, AI drafts), the category taxonomy and the EVS video picker.
 * See docs/api/rest-contract.md ("Admin: courses", "Admin: catalog ... EVS").
 */
import type {
  AdminCourse, AdminCourseRow, AdminItem, AdminPrice, AdminQuestion, AdminSection, Category, CourseLevel, CourseStaffRole, CourseStatus, EnrollmentSource,
  EvsVideo, ItemKind, LectureKind, Page, QuestionKind, QuizSelection, RevealPolicy, TextMatch, UserSummary, VideoProvider,
} from "@open-lms/types";
import { enc, type Helpers, type PageQuery } from "./helpers";

export interface AdminCoursePatch {
  title?: string;
  subtitle?: string | null;
  description?: string;
  outcomes?: string[];
  prerequisites?: string[];
  level?: CourseLevel;
  language?: string;
  coverUploadId?: string | null;
  categoryIds?: string[];
  /** Owner or admin only, like the three below. */
  slug?: string;
  accessMode?: "FREE" | "PAID" | "SUBSCRIPTION_ONLY";
  includedInSubscription?: boolean;
  certificateEnabled?: boolean;
  /** Admins only. */
  featured?: boolean;
}

export interface AdminItemPatch {
  title?: string;
  isPreview?: boolean;
  durationSeconds?: number;
  lecture?: { lectureKind?: LectureKind; videoProvider?: VideoProvider; videoRef?: string | null; body?: string | null; pdfUploadId?: string | null };
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
    /** Criteria without an id get one from the server; keep ids stable once learners are scored by them. */
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

export interface AdminQuestionInput {
  kind: QuestionKind;
  prompt: string;
  explanation?: string | null;
  points?: number;
  /** Ids are optional: the server assigns "a", "b", ... */
  options?: { id?: string; text: string; correct: boolean }[];
  acceptedAnswers?: string[];
  matchMode?: TextMatch;
  tags?: string[];
}

export type AdminQuestionDraft = Omit<AdminQuestion, "id" | "usedInQuizzes" | "updatedAt">;

export interface AdminCourseLearner {
  user: UserSummary;
  progressPercent: number;
  completedAt: string | null;
  source: EnrollmentSource;
  createdAt: string;
}

export function authoringEndpoints(h: Helpers) {
  const { get, post, put, patch, del, pq } = h;
  const c = (id: string) => `/admin/courses/${enc(id)}`;

  const authoring = {
    courses: {
      list: (q?: PageQuery & { q?: string; status?: CourseStatus }) => get<Page<AdminCourseRow>>("/admin/courses", pq(q)),
      create: (body: { title: string; slug?: string }) => post<AdminCourse>("/admin/courses", body),
      get: (id: string) => get<AdminCourse>(c(id)),
      update: (id: string, body: AdminCoursePatch) => patch<AdminCourse>(c(id), body),
      /** Unused drafts only; 409 COURSE_IN_USE means archive instead. */
      remove: (id: string) => del(c(id)),
      /** 422 PUBLISH_BLOCKED carries `details.checklist`. */
      publish: (id: string) => post<AdminCourse>(`${c(id)}/publish`),
      unpublish: (id: string) => post<AdminCourse>(`${c(id)}/unpublish`),
      archive: (id: string) => post<AdminCourse>(`${c(id)}/archive`),
      setPrices: (id: string, prices: { currency: string; amountMinor: number; compareAtMinor?: number | null }[]) => put<AdminPrice[]>(`${c(id)}/prices`, { prices }),
      setStaff: (id: string, staff: { userId: string; role: CourseStaffRole; listed: boolean }[]) => put<AdminCourse>(`${c(id)}/staff`, { staff }),
      learners: (id: string, q?: PageQuery) => get<Page<AdminCourseLearner>>(`${c(id)}/learners`, pq(q)),
    },
    sections: {
      create: (courseId: string, title: string) => post<AdminSection>(`${c(courseId)}/sections`, { title }),
      rename: (courseId: string, sectionId: string, title: string) => patch<AdminSection>(`${c(courseId)}/sections/${enc(sectionId)}`, { title }),
      remove: (courseId: string, sectionId: string) => del(`${c(courseId)}/sections/${enc(sectionId)}`),
      move: (courseId: string, sectionId: string, toIndex: number) => post<AdminSection[]>(`${c(courseId)}/sections/${enc(sectionId)}/move`, { toIndex }),
    },
    items: {
      create: (courseId: string, body: { sectionId: string; kind: ItemKind; title: string; lectureKind?: LectureKind }) => post<AdminItem>(`${c(courseId)}/items`, body),
      get: (courseId: string, itemId: string) => get<AdminItem>(`${c(courseId)}/items/${enc(itemId)}`),
      update: (courseId: string, itemId: string, body: AdminItemPatch) => patch<AdminItem>(`${c(courseId)}/items/${enc(itemId)}`, body),
      remove: (courseId: string, itemId: string) => del(`${c(courseId)}/items/${enc(itemId)}`),
      move: (courseId: string, itemId: string, sectionId: string, toIndex: number) => post<AdminSection[]>(`${c(courseId)}/items/${enc(itemId)}/move`, { sectionId, toIndex }),
      addResource: (courseId: string, itemId: string, body: { title: string; uploadId?: string; url?: string }) => post<AdminItem>(`${c(courseId)}/items/${enc(itemId)}/resources`, body),
      removeResource: (courseId: string, itemId: string, resourceId: string) => del<AdminItem>(`${c(courseId)}/items/${enc(itemId)}/resources/${enc(resourceId)}`),
      /** FIXED quizzes: the questions, in order. */
      setQuestions: (courseId: string, itemId: string, questionIds: string[]) => put<AdminItem>(`${c(courseId)}/items/${enc(itemId)}/questions`, { questionIds }),
    },
    questions: {
      list: (courseId: string, q?: PageQuery & { q?: string; tag?: string }) => get<Page<AdminQuestion>>(`${c(courseId)}/questions`, pq(q)),
      create: (courseId: string, body: AdminQuestionInput) => post<AdminQuestion>(`${c(courseId)}/questions`, body),
      update: (courseId: string, questionId: string, body: Partial<AdminQuestionInput>) => patch<AdminQuestion>(`${c(courseId)}/questions/${enc(questionId)}`, body),
      /** Resolves to the archived question when a quiz still uses it, else nothing (deleted). */
      remove: (courseId: string, questionId: string) => del<AdminQuestion | undefined>(`${c(courseId)}/questions/${enc(questionId)}`),
    },
    ai: {
      /** Drafts only: save the ones you keep with `questions.create`. */
      draftQuestions: (courseId: string, body: { itemId?: string; sourceText?: string; count: number; kinds: QuestionKind[] }) => post<{ drafts: AdminQuestionDraft[] }>(`${c(courseId)}/ai/questions`, body),
      polish: (courseId: string, body: { field: "description" | "subtitle" | "outcome"; text: string }) => post<{ text: string }>(`${c(courseId)}/ai/polish`, body),
    },
    categories: {
      list: () => get<Category[]>("/admin/catalog/categories"),
      create: (body: { name: string; slug?: string; description?: string | null }) => post<Category[]>("/admin/catalog/categories", body),
      update: (id: string, body: { name?: string; slug?: string; description?: string | null }) => patch<Category>(`/admin/catalog/categories/${enc(id)}`, body),
      remove: (id: string) => del<Category>(`/admin/catalog/categories/${enc(id)}`),
      reorder: (ids: string[]) => post<Category[]>("/admin/catalog/categories/reorder", { ids }),
    },
    evs: {
      videos: (q?: { q?: string; page?: number }) => get<{ items: EvsVideo[]; page: number; total: number }>("/admin/evs/videos", pq(q)),
      status: () => get<{ configured: boolean; canListVideos: boolean }>("/admin/evs/status"),
    },
  };

  return { authoring };
}
