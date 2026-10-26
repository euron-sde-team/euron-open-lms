/**
 * Courses for the /admin editor: list rows (AdminCourseRow) and the full editor shape
 * (AdminCourse, with the curriculum outline and the publish checklist). Related users,
 * covers and prices are batch-loaded once per response.
 */
import type { AdminCourse, AdminCourseRow, AdminPrice, CourseStaffRole, UserSummary } from "@open-lms/types";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { publishChecklist, type ChecklistEntry } from "../domain/authoring-rules";
import { adminCourseRepo, type CoursePriceRow, type CourseRow, type StaffRow } from "../repositories/admin-course.repository";
import { money } from "../repositories/price.repository";
import { getSettings } from "../services/settings.service";
import { sectionsOf } from "./curriculum.presenter";
import { loadMedia, urlOf } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

type Course = Omit<CourseRow, "search">;

export function toAdminPrice(p: CoursePriceRow): AdminPrice {
  return {
    id: p.id,
    currency: p.currency,
    amount: money(Number(p.amount_minor), p.currency),
    compareAt: p.compare_at_minor === null ? null : money(Number(p.compare_at_minor), p.currency),
    interval: p.interval,
    active: p.active,
  };
}

function rating(c: Course): AdminCourseRow["rating"] {
  return c.rating_count > 0 ? { average: Math.round((c.rating_sum / c.rating_count) * 10) / 10, count: c.rating_count } : null;
}

function staffList(rows: StaffRow[], users: Map<string, UserSummary>) {
  return rows.flatMap((s) => {
    const u = users.get(s.user_id);
    return u ? [{ ...u, courseRole: s.role, listed: s.listed }] : [];
  });
}

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

export async function toCourseRows(courses: Course[], actor: Actor, exec: Executor = db): Promise<AdminCourseRow[]> {
  const ids = courses.map((c) => c.id);
  const [staff, prices, covers] = await Promise.all([adminCourseRepo.staffOf(ids, exec), adminCourseRepo.pricesOf(ids, exec), loadMedia(courses.map((c) => c.cover_upload_id), exec)]);
  const users = await loadSummaries(staff.map((s) => s.user_id), exec);
  const staffBy = group(staff, (s) => s.course_id);
  const pricesBy = group(prices, (p) => p.sellable_id);
  return courses.map((c) => {
    const st = staffBy.get(c.id) ?? [];
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      coverUrl: urlOf(covers, c.cover_upload_id, "thumb"),
      status: c.status,
      accessMode: c.access_mode,
      itemCount: c.item_count,
      enrollmentCount: c.enrollment_count,
      rating: rating(c),
      prices: (pricesBy.get(c.id) ?? []).map((p) => money(Number(p.amount_minor), p.currency)),
      staff: staffList(st, users).map(({ listed: _listed, ...rest }) => rest),
      myRole: (st.find((s) => s.user_id === actor.id)?.role ?? null) as CourseStaffRole | null,
      updatedAt: c.updated_at.toISOString(),
      publishedAt: c.published_at?.toISOString() ?? null,
    };
  });
}

/** What blocks publishing this course right now. */
export async function checklistOf(c: Course, exec: Executor = db): Promise<ChecklistEntry[]> {
  const [facts, prices, settings] = await Promise.all([adminCourseRepo.checklistFacts(c.id, exec), adminCourseRepo.pricesOf([c.id], exec), getSettings(exec)]);
  const enabled = new Set(settings.currencies.enabled);
  return publishChecklist({
    itemCount: c.item_count,
    hasCover: !!c.cover_upload_id,
    description: c.description,
    accessMode: c.access_mode,
    sellablePrices: prices.filter((p) => enabled.has(p.currency) && Number(p.amount_minor) > 0).length,
    videos: facts.videos.map((v) => ({ itemId: v.id, title: v.title, hasRef: !!v.video_ref, status: v.video_status })),
    quizzes: facts.quizzes.map((q) => ({ itemId: q.id, title: q.title, selection: q.selection, questions: Number(q.questions ?? 0), drawable: Number(q.drawable ?? 0) })),
  });
}

export async function toAdminCourse(c: Course, actor: Actor, exec: Executor = db): Promise<AdminCourse> {
  const [staff, prices, categoryIds, media, sections, checklist] = await Promise.all([
    adminCourseRepo.staffOf([c.id], exec),
    adminCourseRepo.pricesOf([c.id], exec),
    adminCourseRepo.categoryIdsOf(c.id, exec),
    loadMedia([c.cover_upload_id], exec),
    sectionsOf(c.id, exec),
    checklistOf(c, exec),
  ]);
  const users = await loadSummaries(staff.map((s) => s.user_id), exec);
  const myRole = staff.find((s) => s.user_id === actor.id)?.role ?? null;
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    subtitle: c.subtitle,
    description: c.description,
    outcomes: c.outcomes,
    prerequisites: c.prerequisites,
    level: c.level,
    language: c.language,
    cover: c.cover_upload_id ? (media.get(c.cover_upload_id) ?? null) : null,
    status: c.status,
    accessMode: c.access_mode,
    includedInSubscription: c.included_in_subscription,
    certificateEnabled: c.certificate_enabled,
    allowDownloads: c.allow_downloads,
    featured: c.featured,
    categoryIds,
    prices: prices.map(toAdminPrice),
    staff: staffList(staff, users),
    myRole,
    canManage: actor.role === "ADMIN" || myRole === "OWNER",
    publishedAt: c.published_at?.toISOString() ?? null,
    updatedAt: c.updated_at.toISOString(),
    sections,
    publishChecklist: checklist,
  };
}
