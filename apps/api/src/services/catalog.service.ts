/**
 * The public catalog and the course page. Reads only, except one-click free enrollment
 * and the wishlist.
 *
 * Rules:
 *   - only PUBLISHED courses are listed; a DRAFT or ARCHIVED course page is 404 to
 *     everyone except its staff and the see-all roles (ADMIN, SUPPORT), who get it
 *     with access STAFF so the web app can show a preview banner;
 *   - CourseDetail.access is computed here from services/access.service.ts `decide`
 *     plus the price book; the web app only renders it;
 *   - free enrollment is for FREE published courses only (domain/entitlements.ts
 *     canSelfEnrollFree) and goes through services/enrollment.service.ts. It is
 *     idempotent: enrolling twice returns the same enrollment.
 */
import type { BundleDetail, BundleCard, CatalogFacets, CatalogSort, Category, CourseAccess, CourseCard, CourseDetail, CourseLevel, Instructor, Page, Review } from "@open-lms/types";
import { COURSE_LEVELS } from "@open-lms/types";
import type { Actor } from "../core/context";
import { withTransaction } from "../core/effects";
import { forbidden, notFound } from "../core/errors";
import { db } from "../db/kysely";
import { flatten, resumeTarget } from "../domain/curriculum";
import { canSelfEnrollFree } from "../domain/entitlements";
import { renderAuthored } from "../domain/markdown";
import { curriculumCounts, presentBundles, presentCurriculum, toCategory } from "../presenters/catalog.presenter";
import { cardPrice, displayCurrency, presentCardMap, presentCards } from "../presenters/course-card.presenter";
import { presentReviews } from "../presenters/review.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { catalogRepo, sortSpec, type CatalogFilters, type CourseDetailRow } from "../repositories/catalog.repository";
import { courseCardRepo } from "../repositories/course-card.repository";
import { decodeScore, decodeTime, encodeScore, pageBy, timePage } from "../repositories/keyset";
import type { PriceRow } from "../repositories/price.repository";
import { decide, findCourse } from "./access.service";
import { grantEnrollment } from "./enrollment.service";

export interface CatalogQuery extends CatalogFilters {
  sort?: CatalogSort;
  currency?: string;
  cursor?: string;
  limit?: number;
}

const SHELF = 8;

export async function listCourses(viewer: Actor | null, q: CatalogQuery): Promise<Page<CourseCard>> {
  const limit = q.limit ?? 20;
  const currency = await displayCurrency(viewer, q.currency);
  const spec = sortSpec(q.sort ?? (q.q?.trim() ? "relevance" : "popular"), q.q);
  const rows = await catalogRepo.search(q, spec, currency, decodeScore(q.cursor), limit);
  const page = pageBy(rows, limit, (r) => encodeScore(Number(r._k), r.id));
  return { items: await presentCards(page.items, { viewer, currency }), nextCursor: page.nextCursor };
}

export async function facets(q: CatalogFilters): Promise<CatalogFacets> {
  const f = await catalogRepo.facets(q);
  const levels = Object.fromEntries(COURSE_LEVELS.map((l) => [l, 0])) as Record<CourseLevel, number>;
  for (const l of f.levels) levels[l.level] = l.count;
  return {
    categories: f.categories.map((c) => ({ slug: String(c.slug), name: c.name, count: c.count })),
    levels,
    languages: f.languages.map((l) => ({ code: l.language, count: l.count })),
    price: f.price,
  };
}

/** Four short shelves for the home page, presented in one batch. */
export async function featured(viewer: Actor | null, requestedCurrency: string | undefined): Promise<{ featured: CourseCard[]; popular: CourseCard[]; newest: CourseCard[]; free: CourseCard[] }> {
  const currency = await displayCurrency(viewer, requestedCurrency);
  const [featuredRows, popular, newest, free] = await Promise.all([catalogRepo.shelf("featured", SHELF), catalogRepo.shelf("popular", SHELF), catalogRepo.shelf("newest", SHELF), catalogRepo.shelf("free", SHELF)]);
  const unique = new Map([...featuredRows, ...popular, ...newest, ...free].map((r) => [r.id, r]));
  const { cards } = await presentCardMap([...unique.values()], { viewer, currency });
  const pick = (rows: { id: string }[]) => rows.map((r) => cards.get(r.id)).filter((c): c is CourseCard => !!c);
  return { featured: pick(featuredRows), popular: pick(popular), newest: pick(newest), free: pick(free) };
}

export async function categories(): Promise<Category[]> {
  return (await catalogRepo.categories()).map(toCategory);
}

// ─── The course page ────────────────────────────────────────────────────────

export async function courseDetail(viewer: Actor | null, slug: string, requestedCurrency: string | undefined): Promise<CourseDetail> {
  const row = await catalogRepo.courseBySlug(slug);
  if (!row) throw notFound("Course not found");
  const { decision } = await decide(viewer, { id: row.id, slug: String(row.slug), title: row.title, status: row.status, access_mode: row.access_mode, included_in_subscription: row.included_in_subscription });
  const isStaffView = decision.granted && decision.via === "STAFF";
  if (row.status !== "PUBLISHED" && !isStaffView) throw notFound("Course not found");

  const currency = await displayCurrency(viewer, requestedCurrency);
  const [presented, curriculum, breakdown, bundleRows] = await Promise.all([
    presentCardMap([row], { viewer, currency }),
    catalogRepo.curriculum(row.id),
    catalogRepo.ratingBreakdown(row.id),
    catalogRepo.bundlesWithCourse(row.id),
  ]);
  const card = presented.cards.get(row.id) as CourseCard;
  const instructorIds = presented.instructorIds.get(row.id) ?? [];
  const [profiles, bundles, access] = await Promise.all([
    catalogRepo.instructorProfiles(instructorIds),
    presentBundles(bundleRows, currency),
    accessFor(viewer, row, decision, presented.prices.get(row.id), flatten(presentCurriculum(curriculum)).map((i) => i.id)),
  ]);
  const bio = new Map(profiles.map((p) => [p.id, p]));
  const instructors: Instructor[] = card.instructors.map((u) => ({ ...u, bio: bio.get(u.id)?.bio ?? null, website: bio.get(u.id)?.website ?? null }));
  const ratingBreakdown: CourseDetail["ratingBreakdown"] = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const b of breakdown) {
    const k = String(b.rating) as keyof CourseDetail["ratingBreakdown"];
    if (k in ratingBreakdown) ratingBreakdown[k] = b.count;
  }
  return {
    ...card,
    status: row.status,
    descriptionHtml: renderAuthored(row.description),
    outcomes: row.outcomes ?? [],
    prerequisites: row.prerequisites ?? [],
    certificateEnabled: row.certificate_enabled,
    instructors,
    sections: presentCurriculum(curriculum),
    counts: curriculumCounts(curriculum.items),
    ratingBreakdown,
    access,
    bundles: bundles.cards,
    updatedAt: row.updated_at.toISOString(),
  };
}

type Decision = Awaited<ReturnType<typeof decide>>["decision"];

/** What the viewer can do with this course (the CourseAccess union). */
async function accessFor(viewer: Actor | null, row: CourseDetailRow, decision: Decision, price: PriceRow | undefined, order: string[]): Promise<CourseAccess> {
  const sale = cardPrice(row, price);
  if (!viewer) return { state: "SIGNED_OUT", free: row.access_mode === "FREE", price: sale.price };
  if (decision.granted) {
    if (decision.via === "STAFF") return { state: "STAFF" };
    const e = await catalogRepo.enrollment(viewer.id, row.id);
    const enrolledRow = e && e.status === "ACTIVE" && (decision.via === "ENROLLMENT" || e.source === "SUBSCRIPTION");
    if (!enrolledRow) return { state: "INCLUDED_IN_PLAN" };
    const completed = await catalogRepo.completedItemIds(viewer.id, row.id);
    return {
      state: "ENROLLED",
      enrollmentId: e.id,
      progressPercent: e.progress_percent,
      completedAt: e.completed_at?.toISOString() ?? null,
      validUntil: e.valid_until?.toISOString() ?? null,
      resumeItemId: resumeTarget(order, completed, e.last_item_id),
    };
  }
  switch (decision.reason) {
    case "EXPIRED":
    case "REVOKED":
    case "REFUNDED":
    case "SUBSCRIPTION_ENDED":
      return { state: "LAPSED", reason: decision.reason, price: sale.price };
    default:
      break;
  }
  if (row.access_mode === "FREE") return { state: "FREE" };
  const planOnSale = row.included_in_subscription && (await catalogRepo.anyActivePlan());
  if (row.access_mode === "PAID" && sale.price) return { state: "PURCHASABLE", price: sale.price, compareAt: sale.compareAt, subscriptionAlso: planOnSale };
  return planOnSale ? { state: "SUBSCRIPTION_REQUIRED" } : { state: "UNAVAILABLE" };
}

export async function reviews(viewer: Actor | null, slug: string, q: { rating?: number; cursor?: string; limit?: number }): Promise<Page<Review>> {
  const course = await findCourse({ slug });
  if (!course || course.status !== "PUBLISHED") throw notFound("Course not found");
  const limit = q.limit ?? 20;
  const page = timePage(await catalogRepo.reviews(course.id, { rating: q.rating, cursor: decodeTime(q.cursor), limit }), limit);
  return { items: await presentReviews(page.items, viewer?.id ?? null), nextCursor: page.nextCursor };
}

// ─── Bundles and instructors ────────────────────────────────────────────────

export async function listBundles(viewer: Actor | null, q: { currency?: string; cursor?: string; limit?: number }): Promise<Page<BundleCard>> {
  const limit = q.limit ?? 20;
  const currency = await displayCurrency(viewer, q.currency);
  const page = timePage(await catalogRepo.activeBundles(decodeTime(q.cursor), limit), limit);
  return { items: (await presentBundles(page.items, currency)).cards, nextCursor: page.nextCursor };
}

export async function bundleDetail(viewer: Actor | null, slug: string, requestedCurrency: string | undefined): Promise<BundleDetail> {
  const row = await catalogRepo.bundleBySlug(slug);
  if (!row) throw notFound("Bundle not found");
  const currency = await displayCurrency(viewer, requestedCurrency);
  const { cards, courseIds } = await presentBundles([row], currency);
  const ids = courseIds.get(row.id) ?? [];
  const courseRows = await courseCardRepo.byIds(ids);
  const byId = new Map(courseRows.map((r) => [r.id, r]));
  const courses = await presentCards(ids.map((id) => byId.get(id)).filter((r) => !!r), { viewer, currency });
  return { ...cards[0], courses, viewerOwnsAll: !!viewer && courses.length > 0 && courses.every((c) => c.viewer?.enrolled) };
}

export async function instructor(viewer: Actor | null, username: string): Promise<{ instructor: Instructor; courses: CourseCard[] }> {
  const row = await catalogRepo.listedInstructor(username);
  if (!row) throw notFound("Instructor not found");
  const [summary, courseRows, currency] = await Promise.all([loadSummaries([row.id]), catalogRepo.coursesTaughtBy(row.id), displayCurrency(viewer, undefined)]);
  const person = summary.get(row.id);
  if (!person) throw notFound("Instructor not found");
  return { instructor: { ...person, bio: row.bio, website: row.website }, courses: await presentCards(courseRows, { viewer, currency }) };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/** One-click enrollment in a FREE course. Idempotent. */
export async function enrollFree(actor: Actor, slug: string): Promise<{ enrollmentId: string; resumeItemId: string | null }> {
  const course = await findCourse({ slug });
  if (!course || course.status !== "PUBLISHED") throw notFound("Course not found");
  if (course.access_mode !== "FREE") throw forbidden("This course is not free", "NOT_FREE");
  if (!canSelfEnrollFree({ course: { status: course.status, accessMode: course.access_mode, includedInSubscription: course.included_in_subscription }, viewer: { role: actor.role, active: actor.status === "ACTIVE" } })) {
    throw forbidden("Your account is restricted", "ACCOUNT_RESTRICTED");
  }
  const enrollmentId = await withTransaction(async (trx, fx) => {
    // Serialise this learner's enrollments so two clicks cannot race the insert.
    await trx.selectFrom("users").select("id").where("id", "=", actor.id).forUpdate().executeTakeFirst();
    const existing = await catalogRepo.enrollment(actor.id, course.id, trx);
    if (existing && existing.status === "ACTIVE" && existing.source !== "SUBSCRIPTION" && (!existing.valid_until || existing.valid_until > new Date())) return existing.id;
    return (await grantEnrollment({ userId: actor.id, courseId: course.id, source: "FREE" }, trx, fx)).id;
  });
  const [{ items }, e, completed] = await Promise.all([catalogRepo.curriculum(course.id), catalogRepo.enrollment(actor.id, course.id), catalogRepo.completedItemIds(actor.id, course.id)]);
  return { enrollmentId, resumeItemId: resumeTarget(items.map((i) => i.id), completed, e?.last_item_id ?? null) };
}

async function publishedCourseId(slug: string): Promise<string> {
  const course = await findCourse({ slug });
  if (!course || course.status !== "PUBLISHED") throw notFound("Course not found");
  return course.id;
}

export async function save(actor: Actor, slug: string): Promise<void> {
  await catalogRepo.save(actor.id, await publishedCourseId(slug), db);
}

export async function unsave(actor: Actor, slug: string): Promise<void> {
  const course = await findCourse({ slug });
  if (course) await catalogRepo.unsave(actor.id, course.id, db);
}
