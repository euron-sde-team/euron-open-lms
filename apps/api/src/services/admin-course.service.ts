/**
 * Courses in the /admin editor: list, create, edit, delete, the status moves (publish,
 * unpublish, archive), prices, staff and the enrolled learners.
 *
 * Rules:
 *   - No mass assignment. PATCH takes an explicit field list and never touches status,
 *     counters or published_at; status moves are their own calls, each a conditional
 *     UPDATE on the expected current status.
 *   - Slugs come from the title (domain/slug.ts) and are made unique with -2, -3, ...;
 *     a unique violation from a concurrent create is retried with the next suffix. An
 *     explicit slug that is taken is a 409 SLUG_TAKEN (the author asked for that one).
 *   - Publish runs the checklist inside the transaction that holds the course row lock;
 *     anything on it is 422 PUBLISH_BLOCKED with the list in `details.checklist`.
 *   - DELETE is for unused drafts only (no enrollments, orders or bundles), else 409
 *     COURSE_IN_USE: archive it instead.
 *   - Prices replace the course's active one-time prices in one transaction (old rows
 *     deactivated, never deleted: orders keep pointing at them).
 *   - Staff: at least one OWNER; people added must exist, be ACTIVE and hold an
 *     INSTRUCTOR, ADMIN or SUPPORT role. A course role never changes a platform role.
 * Every write is audited in its own transaction.
 */
import type { AdminCourse, AdminCourseRow, AdminPrice, CourseLevel, CourseStaffRole, Page, UserSummary } from "@open-lms/types";
import { requireArea, type Actor, type RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { isCourseSlug, nextSlug, slugBase } from "../domain/authoring-rules";
import { checklistOf, toAdminCourse, toAdminPrice, toCourseRows } from "../presenters/admin-course.presenter";
import { loadSummaries } from "../presenters/user.presenter";
import { adminCourseRepo, type CourseRow } from "../repositories/admin-course.repository";
import { categoryRepo } from "../repositories/category.repository";
import { decodeTime } from "../repositories/keyset";
import { manageableCourseIds } from "./access.service";
import { audit } from "./audit.service";
import { courseRights } from "./authoring-access.service";
import { claimSingle } from "./media-attach.service";
import { getSettings } from "./settings.service";

const SLUG_RETRIES = 5;

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23505" && e.constraint === constraint;
}

async function loadCourse(id: string): Promise<Omit<CourseRow, "search">> {
  const c = await adminCourseRepo.findById(id);
  if (!c) throw notFound("Course not found");
  return c;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function listCourses(actor: Actor, q: { q?: string; status?: CourseRow["status"]; cursor?: string; limit?: number }): Promise<Page<AdminCourseRow>> {
  requireArea(actor, "courses");
  const ids = await manageableCourseIds(actor);
  const page = await adminCourseRepo.list({ ids, q: q.q, status: q.status, key: decodeTime(q.cursor), limit: q.limit ?? 20 });
  return { items: await toCourseRows(page.items, actor), nextCursor: page.nextCursor };
}

export async function getCourse(actor: Actor, id: string): Promise<AdminCourse> {
  await courseRights(actor, id, "read");
  return toAdminCourse(await loadCourse(id), actor);
}

// ─── Create, edit, delete ───────────────────────────────────────────────────

export async function createCourse(actor: Actor, input: { title: string; slug?: string }, meta: RequestMeta): Promise<AdminCourse> {
  requireArea(actor, "courses");
  if (actor.role !== "INSTRUCTOR" && actor.role !== "ADMIN") throw forbidden("Only instructors and admins create courses", "COURSE_CREATE_FORBIDDEN");
  if (input.slug !== undefined && !isCourseSlug(input.slug)) throw badRequest("A slug is 3 to 60 lower-case letters, digits and single hyphens", "INVALID_SLUG");

  for (let attempt = 0; ; attempt++) {
    try {
      const id = await withTransaction(async (trx) => {
        let slug: string;
        if (input.slug) {
          if (await adminCourseRepo.slugTaken(input.slug, null, trx)) throw conflict("That slug is already used by another course", "SLUG_TAKEN");
          slug = input.slug;
        } else {
          const base = slugBase(input.title, "course");
          slug = nextSlug(base, await adminCourseRepo.slugsLike(base, trx));
        }
        const id = newId();
        await adminCourseRepo.insert({ id, slug, title: input.title, created_by: actor.id }, trx);
        await trx.insertInto("course_staff").values({ course_id: id, user_id: actor.id, role: "OWNER", listed: true, position: 0, added_by: actor.id }).execute();
        await audit({ actorId: actor.id, action: "course.create", entityType: "course", entityId: id, ip: meta.ip, data: { slug, title: input.title } }, trx);
        return id;
      });
      return toAdminCourse(await loadCourse(id), actor);
    } catch (err) {
      if (isUniqueViolation(err, "courses_slug_key") && attempt < SLUG_RETRIES) {
        if (input.slug) throw conflict("That slug is already used by another course", "SLUG_TAKEN");
        continue;
      }
      throw err;
    }
  }
}

export interface CoursePatch {
  title?: string;
  subtitle?: string | null;
  description?: string;
  outcomes?: string[];
  prerequisites?: string[];
  level?: CourseLevel;
  language?: string;
  coverUploadId?: string | null;
  categoryIds?: string[];
  slug?: string;
  accessMode?: "FREE" | "PAID" | "SUBSCRIPTION_ONLY";
  includedInSubscription?: boolean;
  certificateEnabled?: boolean;
  allowDownloads?: boolean;
  featured?: boolean;
}

/** Fields only the owner (or an admin) may change; `featured` is catalog curation, admins only. */
const SETTINGS_FIELDS = ["slug", "accessMode", "includedInSubscription", "certificateEnabled", "allowDownloads"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function updateCourse(actor: Actor, id: string, patch: CoursePatch, meta: RequestMeta): Promise<AdminCourse> {
  const touchesSettings = SETTINGS_FIELDS.some((f) => patch[f] !== undefined);
  await courseRights(actor, id, touchesSettings ? "manage" : "edit");
  if (patch.featured !== undefined && actor.role !== "ADMIN") throw forbidden("Only admins feature courses", "COURSE_ROLE_REQUIRED");
  if (patch.slug !== undefined && !isCourseSlug(patch.slug)) throw badRequest("A slug is 3 to 60 lower-case letters, digits and single hyphens", "INVALID_SLUG");

  try {
    await withTransaction(async (trx) => {
      const current = await adminCourseRepo.lock(id, trx);
      const set: Parameters<typeof adminCourseRepo.update>[1] = {};
      const changed: string[] = [];
      const put = <K extends keyof typeof set>(field: string, column: K, value: (typeof set)[K], old: unknown) => {
        if (value === undefined || same(value, old)) return;
        set[column] = value;
        changed.push(field);
      };
      put("title", "title", patch.title, current.title);
      put("subtitle", "subtitle", patch.subtitle, current.subtitle);
      put("description", "description", patch.description, current.description);
      put("outcomes", "outcomes", patch.outcomes, current.outcomes);
      put("prerequisites", "prerequisites", patch.prerequisites, current.prerequisites);
      put("level", "level", patch.level, current.level);
      put("language", "language", patch.language, current.language);
      put("certificateEnabled", "certificate_enabled", patch.certificateEnabled, current.certificate_enabled);
      put("allowDownloads", "allow_downloads", patch.allowDownloads, current.allow_downloads);
      put("featured", "featured", patch.featured, current.featured);

      if (patch.coverUploadId !== undefined && patch.coverUploadId !== current.cover_upload_id) {
        set.cover_upload_id = await claimSingle(actor.id, patch.coverUploadId, "COURSE_COVER", trx);
        changed.push("cover");
      }
      if (patch.slug !== undefined && patch.slug !== current.slug) {
        if (await adminCourseRepo.slugTaken(patch.slug, id, trx)) throw conflict("That slug is already used by another course", "SLUG_TAKEN");
        set.slug = patch.slug;
        changed.push("slug");
      }

      // SUBSCRIPTION_ONLY is always included in the subscription (a CHECK in the schema).
      const mode = patch.accessMode ?? current.access_mode;
      let included = patch.includedInSubscription ?? current.included_in_subscription;
      if (mode === "SUBSCRIPTION_ONLY") {
        if (patch.includedInSubscription === false) throw badRequest("A subscription-only course is always included in the subscription", "SUBSCRIPTION_ONLY_INCLUDED");
        included = true;
      }
      put("accessMode", "access_mode", patch.accessMode, current.access_mode);
      put("includedInSubscription", "included_in_subscription", included, current.included_in_subscription);

      if (patch.categoryIds !== undefined) {
        const wanted = [...new Set(patch.categoryIds)];
        const found = await categoryRepo.existing(wanted, trx);
        if (found.size !== wanted.length) throw badRequest("One of the categories does not exist", "CATEGORY_NOT_FOUND");
        const before = await adminCourseRepo.categoryIdsOf(id, trx);
        if (!same([...before].sort(), [...wanted].sort())) {
          await adminCourseRepo.replaceCategories(id, wanted, trx);
          changed.push("categories");
        }
      }

      if (Object.keys(set).length) await adminCourseRepo.update(id, set, trx);
      if (changed.length) await audit({ actorId: actor.id, action: "course.update", entityType: "course", entityId: id, ip: meta.ip, data: { fields: changed } }, trx);
    });
  } catch (err) {
    if (isUniqueViolation(err, "courses_slug_key")) throw conflict("That slug is already used by another course", "SLUG_TAKEN");
    throw err;
  }
  return toAdminCourse(await loadCourse(id), actor);
}

export async function deleteCourse(actor: Actor, id: string, meta: RequestMeta): Promise<void> {
  await courseRights(actor, id, "manage");
  await withTransaction(async (trx) => {
    const current = await adminCourseRepo.lock(id, trx);
    if (current.status !== "DRAFT" || (await adminCourseRepo.inUse(id, trx))) {
      throw conflict("This course has learners, orders or is live: archive it instead", "COURSE_IN_USE");
    }
    if (!(await adminCourseRepo.deleteDraft(id, trx))) throw conflict("This course is no longer a draft: archive it instead", "COURSE_IN_USE");
    await audit({ actorId: actor.id, action: "course.delete", entityType: "course", entityId: id, ip: meta.ip, data: { slug: current.slug, title: current.title } }, trx);
  });
}

// ─── Status moves ───────────────────────────────────────────────────────────

export async function publishCourse(actor: Actor, id: string, meta: RequestMeta): Promise<AdminCourse> {
  await courseRights(actor, id, "manage");
  await withTransaction(async (trx) => {
    const current = await adminCourseRepo.lock(id, trx);
    if (current.status === "PUBLISHED") throw conflict("The course is already published", "INVALID_STATUS");
    const checklist = await checklistOf(current, trx);
    if (checklist.length) throw unprocessable("The course is not ready to publish", "PUBLISH_BLOCKED", { checklist });
    const moved = await adminCourseRepo.transition(id, ["DRAFT", "ARCHIVED"], { status: "PUBLISHED", published_at: current.published_at ?? new Date() }, trx);
    if (!moved) throw conflict("The course changed status, reload it", "INVALID_STATUS");
    await audit({ actorId: actor.id, action: "course.publish", entityType: "course", entityId: id, ip: meta.ip, data: { from: current.status } }, trx);
  });
  return toAdminCourse(await loadCourse(id), actor);
}

export async function unpublishCourse(actor: Actor, id: string, meta: RequestMeta): Promise<AdminCourse> {
  return move(actor, id, ["PUBLISHED"], "DRAFT", "course.unpublish", meta);
}

export async function archiveCourse(actor: Actor, id: string, meta: RequestMeta): Promise<AdminCourse> {
  return move(actor, id, ["DRAFT", "PUBLISHED"], "ARCHIVED", "course.archive", meta);
}

async function move(actor: Actor, id: string, from: CourseRow["status"][], to: CourseRow["status"], action: string, meta: RequestMeta): Promise<AdminCourse> {
  await courseRights(actor, id, "manage");
  await withTransaction(async (trx) => {
    const current = await adminCourseRepo.lock(id, trx);
    if (!(await adminCourseRepo.transition(id, from, { status: to }, trx))) throw conflict(`A ${current.status.toLowerCase()} course cannot move to ${to.toLowerCase()}`, "INVALID_STATUS");
    await audit({ actorId: actor.id, action, entityType: "course", entityId: id, ip: meta.ip, data: { from: current.status } }, trx);
  });
  return toAdminCourse(await loadCourse(id), actor);
}

// ─── Prices and staff ───────────────────────────────────────────────────────

export async function setPrices(actor: Actor, id: string, prices: { currency: string; amountMinor: number; compareAtMinor?: number | null }[], meta: RequestMeta): Promise<AdminPrice[]> {
  await courseRights(actor, id, "manage");
  const settings = await getSettings();
  const enabled = new Set(settings.currencies.enabled);
  const seen = new Set<string>();
  for (const p of prices) {
    if (seen.has(p.currency)) throw badRequest(`${p.currency} is listed twice`, "DUPLICATE_CURRENCY");
    seen.add(p.currency);
    if (!enabled.has(p.currency)) throw badRequest(`${p.currency} is not one of the academy's currencies`, "CURRENCY_NOT_ENABLED");
    if (p.amountMinor === 0) throw badRequest("A price of zero is not a price: make the course FREE instead", "PRICE_ZERO");
    if (p.compareAtMinor !== undefined && p.compareAtMinor !== null && p.compareAtMinor <= p.amountMinor) throw badRequest("The compare-at price must be higher than the price", "COMPARE_AT_TOO_LOW");
  }
  return withTransaction(async (trx) => {
    await adminCourseRepo.lock(id, trx);
    const before = await adminCourseRepo.pricesOf([id], trx);
    const rows = prices.map((p) => ({ id: newId(), currency: p.currency, amountMinor: p.amountMinor, compareAtMinor: p.compareAtMinor ?? null }));
    await adminCourseRepo.replacePrices(id, rows, trx);
    await audit(
      {
        actorId: actor.id,
        action: "price.set",
        entityType: "course",
        entityId: id,
        ip: meta.ip,
        data: { before: before.map((p) => ({ currency: p.currency, amountMinor: Number(p.amount_minor) })), after: rows.map((p) => ({ currency: p.currency, amountMinor: p.amountMinor })) },
      },
      trx,
    );
    return (await adminCourseRepo.pricesOf([id], trx)).map(toAdminPrice);
  });
}

const STAFF_ROLES = new Set(["INSTRUCTOR", "ADMIN", "SUPPORT"]);

export async function setStaff(actor: Actor, id: string, staff: { userId: string; role: CourseStaffRole; listed: boolean }[], meta: RequestMeta): Promise<AdminCourse> {
  await courseRights(actor, id, "manage");
  const ids = staff.map((s) => s.userId);
  if (new Set(ids).size !== ids.length) throw badRequest("A person is listed twice", "DUPLICATE_STAFF");
  if (!staff.some((s) => s.role === "OWNER")) throw badRequest("A course needs at least one owner", "OWNER_REQUIRED");

  await withTransaction(async (trx) => {
    await adminCourseRepo.lock(id, trx);
    const before = await adminCourseRepo.staffOf([id], trx);
    const existing = new Set(before.map((s) => s.user_id));
    const added = ids.filter((u) => !existing.has(u));
    if (added.length) {
      const users = await trx.selectFrom("users").select(["id", "role", "status"]).where("id", "in", added).execute();
      const byId = new Map(users.map((u) => [u.id, u]));
      for (const u of added) {
        const row = byId.get(u);
        if (!row) throw badRequest("One of the people was not found", "USER_NOT_FOUND");
        if (row.status !== "ACTIVE") throw badRequest("Only active accounts can join a course's staff", "USER_INACTIVE");
        if (!STAFF_ROLES.has(row.role)) throw badRequest("Only instructors, support staff and admins can join a course's staff", "NOT_STAFF_ROLE");
      }
    }
    await adminCourseRepo.replaceStaff(id, staff, actor.id, trx);
    await audit(
      {
        actorId: actor.id,
        action: "staff.set",
        entityType: "course",
        entityId: id,
        ip: meta.ip,
        data: { before: before.map((s) => ({ userId: s.user_id, role: s.role })), after: staff.map((s) => ({ userId: s.userId, role: s.role, listed: s.listed })) },
      },
      trx,
    );
  });
  return toAdminCourse(await loadCourse(id), actor);
}

// ─── Learners ───────────────────────────────────────────────────────────────

export interface CourseLearner {
  user: UserSummary;
  progressPercent: number;
  completedAt: string | null;
  source: "FREE" | "PURCHASE" | "BUNDLE" | "SUBSCRIPTION" | "GRANT";
  createdAt: string;
}

export async function courseLearners(actor: Actor, id: string, q: { cursor?: string; limit?: number }): Promise<Page<CourseLearner>> {
  await courseRights(actor, id, "read");
  const page = await adminCourseRepo.learners(id, decodeTime(q.cursor), q.limit ?? 20, db);
  const users = await loadSummaries(page.items.map((r) => r.user_id));
  return {
    items: page.items.flatMap((r) => {
      const user = users.get(r.user_id);
      return user ? [{ user, progressPercent: r.progress_percent, completedAt: r.completed_at?.toISOString() ?? null, source: r.source, createdAt: r.created_at.toISOString() }] : [];
    }),
    nextCursor: page.nextCursor,
  };
}
