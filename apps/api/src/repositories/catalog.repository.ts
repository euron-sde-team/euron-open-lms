/**
 * The public catalog: search, facets, featured shelves, the course page, reviews,
 * bundles and instructor pages. Only PUBLISHED courses (and ACTIVE bundles) are ever
 * listed here; the course page reads any status and lets the service decide who may
 * see a draft.
 *
 * Search: the weighted `courses.search` tsvector (prefix match) OR a title trigram
 * ILIKE (courses_title_trgm_idx), so "script" also finds "JavaScript". Sorting uses a
 * float8 sort key per sort, selected as `_k`, and keyset cursors carry (key, id):
 *   relevance   ts_rank_cd + title similarity (popular when there is no query)
 *   popular     enrollment_count
 *   newest      published_at in epoch milliseconds (exact in float8)
 *   rating      rating_sum / rating_count, unrated courses last
 *   price_*     the price in the requested currency; courses without one sort last
 * Facets are four grouped queries over the same filters, each ignoring its own
 * dimension (picking "Beginner" must not make the other levels disappear).
 */
import type { CatalogSort, CourseLevel } from "@open-lms/types";
import { sql, type Expression, type RawBuilder, type SqlBool } from "kysely";
import { db, type Executor } from "../db/kysely";
import { CARD_COLUMNS, type CardRow } from "./course-card.repository";
import { atKey, olderThan, type ScoreKey, type TimeKey } from "./keyset";
import { titleLike, tsMatches, tsRank } from "./text-search";

export type PriceFilter = "free" | "paid" | "subscription";

export interface CatalogFilters {
  q?: string;
  category?: string;
  level?: CourseLevel;
  language?: string;
  price?: PriceFilter;
}

type Dimension = "category" | "level" | "language" | "price";

/** Price sorts push courses without a price past every real amount. */
const NO_PRICE_ASC = 9007199254740991;

function allOf(conds: Expression<SqlBool>[]): Expression<SqlBool> {
  return conds.length ? sql<SqlBool>`(${sql.join(conds, sql` AND `)})` : sql<SqlBool>`true`;
}

/** The WHERE of a catalog query over `courses as c`, optionally without one dimension (facets). */
function conditions(f: CatalogFilters, except?: Dimension): Expression<SqlBool> {
  const conds: Expression<SqlBool>[] = [sql<SqlBool>`c.status = 'PUBLISHED'`];
  const q = f.q?.trim();
  if (q) conds.push(sql<SqlBool>`(${tsMatches("c.search", q)} OR ${titleLike("c.title", q)})`);
  if (f.category && except !== "category") {
    conds.push(sql<SqlBool>`EXISTS (SELECT 1 FROM course_categories fcc JOIN categories fk ON fk.id = fcc.category_id WHERE fcc.course_id = c.id AND fk.slug = ${f.category})`);
  }
  if (f.level && except !== "level") conds.push(sql<SqlBool>`c.level = ${f.level}`);
  if (f.language && except !== "language") conds.push(sql<SqlBool>`c.language = ${f.language}`);
  if (f.price && except !== "price") {
    if (f.price === "free") conds.push(sql<SqlBool>`c.access_mode = 'FREE'`);
    else if (f.price === "paid") conds.push(sql<SqlBool>`c.access_mode = 'PAID'`);
    else conds.push(sql<SqlBool>`c.included_in_subscription`);
  }
  return allOf(conds);
}

export interface SortSpec {
  sort: Exclude<CatalogSort, "relevance"> | "relevance";
  key: RawBuilder<number>;
  dir: "asc" | "desc";
  joinsPrice: boolean;
}

/** The sort key expression for a sort; `relevance` without a query falls back to popularity. */
export function sortSpec(sort: CatalogSort, q: string | undefined): SortSpec {
  const query = q?.trim();
  switch (sort) {
    case "relevance":
      if (query) return { sort, key: sql<number>`(${tsRank("c.search", query)} + similarity(c.title, ${query}))::float8`, dir: "desc", joinsPrice: false };
      return { sort: "popular", key: sql<number>`c.enrollment_count::float8`, dir: "desc", joinsPrice: false };
    case "popular":
      return { sort, key: sql<number>`c.enrollment_count::float8`, dir: "desc", joinsPrice: false };
    case "newest":
      return { sort, key: sql<number>`(extract(epoch FROM coalesce(c.published_at, c.created_at)) * 1000)::float8`, dir: "desc", joinsPrice: false };
    case "rating":
      return { sort, key: sql<number>`(CASE WHEN c.rating_count = 0 THEN -1 ELSE c.rating_sum::float8 / c.rating_count END)`, dir: "desc", joinsPrice: false };
    case "price_asc":
      return { sort, key: sql<number>`coalesce(sp.amount_minor, ${NO_PRICE_ASC})::float8`, dir: "asc", joinsPrice: true };
    case "price_desc":
      return { sort, key: sql<number>`coalesce(sp.amount_minor, -1)::float8`, dir: "desc", joinsPrice: true };
  }
}

export interface CourseDetailRow extends CardRow {
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  description: string;
  outcomes: string[];
  prerequisites: string[];
  certificate_enabled: boolean;
  updated_at: Date;
}

export class CatalogRepository {
  /** One page of catalog cards, with the sort key `_k` for the next cursor. */
  async search(f: CatalogFilters, spec: SortSpec, currency: string, cursor: ScoreKey | null, limit: number, exec: Executor = db): Promise<(CardRow & { _k: number })[]> {
    const op = spec.dir === "desc" ? sql`<` : sql`>`;
    const after = cursor ? sql<SqlBool>`(${spec.key}, c.id) ${op} (${cursor.score}::float8, ${cursor.id})` : sql<SqlBool>`true`;
    let q = exec.selectFrom("courses as c");
    if (spec.joinsPrice) {
      q = q.leftJoin("prices as sp", (j) =>
        j.onRef("sp.sellable_id", "=", "c.id").on("sp.sellable_type", "=", "COURSE").on("sp.currency", "=", currency).on("sp.active", "=", true).on("sp.interval", "is", null),
      ) as unknown as typeof q;
    }
    const dir = spec.dir === "desc" ? sql`DESC` : sql`ASC`;
    return (await q
      .select([...CARD_COLUMNS])
      .select(spec.key.as("_k"))
      .where(conditions(f))
      .where(after)
      .orderBy(sql`${spec.key} ${dir}`)
      .orderBy(sql`c.id ${dir}`)
      .limit(limit + 1)
      .execute()) as (CardRow & { _k: number })[];
  }

  async facets(f: CatalogFilters, exec: Executor = db) {
    const [categories, levels, languages, price] = await Promise.all([
      exec
        .selectFrom("courses as c")
        .innerJoin("course_categories as cc", "cc.course_id", "c.id")
        .innerJoin("categories as k", "k.id", "cc.category_id")
        .select(["k.slug", "k.name", sql<number>`count(*)::int`.as("count")])
        .where(conditions(f, "category"))
        .groupBy(["k.id", "k.slug", "k.name", "k.position"])
        .orderBy("k.position")
        .orderBy("k.name")
        .execute(),
      exec.selectFrom("courses as c").select(["c.level", sql<number>`count(*)::int`.as("count")]).where(conditions(f, "level")).groupBy("c.level").execute(),
      exec
        .selectFrom("courses as c")
        .select(["c.language", sql<number>`count(*)::int`.as("count")])
        .where(conditions(f, "language"))
        .groupBy("c.language")
        .orderBy(sql`count(*) DESC`)
        .orderBy("c.language")
        .execute(),
      exec
        .selectFrom("courses as c")
        .select([
          sql<number>`count(*) FILTER (WHERE c.access_mode = 'FREE')::int`.as("free"),
          sql<number>`count(*) FILTER (WHERE c.access_mode = 'PAID')::int`.as("paid"),
          sql<number>`count(*) FILTER (WHERE c.included_in_subscription)::int`.as("subscription"),
        ])
        .where(conditions(f, "price"))
        .executeTakeFirstOrThrow(),
    ]);
    return { categories, levels, languages, price };
  }

  /** A short published shelf: featured, popular, newest or free. */
  shelf(kind: "featured" | "popular" | "newest" | "free", limit: number, exec: Executor = db): Promise<CardRow[]> {
    let q = exec.selectFrom("courses as c").select([...CARD_COLUMNS]).where("c.status", "=", "PUBLISHED");
    if (kind === "featured") q = q.where("c.featured", "=", true);
    if (kind === "free") q = q.where("c.access_mode", "=", "FREE");
    q = kind === "newest" || kind === "featured" ? q.orderBy("c.published_at", (ob) => ob.desc().nullsLast()) : q.orderBy("c.enrollment_count", "desc");
    return q.orderBy("c.id", "desc").limit(limit).execute() as Promise<CardRow[]>;
  }

  /** Categories with their number of published courses. */
  categories(exec: Executor = db) {
    return exec
      .selectFrom("categories as k")
      .select([
        "k.id",
        "k.slug",
        "k.name",
        "k.description",
        sql<number>`(SELECT count(*)::int FROM course_categories cc JOIN courses c ON c.id = cc.course_id WHERE cc.category_id = k.id AND c.status = 'PUBLISHED')`.as("course_count"),
      ])
      .orderBy("k.position")
      .orderBy("k.name")
      .execute();
  }

  courseBySlug(slug: string, exec: Executor = db): Promise<CourseDetailRow | undefined> {
    return exec
      .selectFrom("courses as c")
      .select([...CARD_COLUMNS, "c.status", "c.description", "c.outcomes", "c.prerequisites", "c.certificate_enabled", "c.updated_at"])
      .where("c.slug", "=", slug)
      .executeTakeFirst() as Promise<CourseDetailRow | undefined>;
  }

  /** Sections and item titles, kinds and durations only: never video refs or bodies. */
  async curriculum(courseId: string, exec: Executor = db) {
    const [sections, items] = await Promise.all([
      exec.selectFrom("course_sections").select(["id", "title"]).where("course_id", "=", courseId).orderBy("position").execute(),
      exec
        .selectFrom("course_items as i")
        .innerJoin("course_sections as s", "s.id", "i.section_id")
        .leftJoin("lectures as l", "l.item_id", "i.id")
        .select(["i.id", "i.section_id", "i.kind", "i.title", "i.duration_seconds", "i.is_preview", "l.lecture_kind"])
        .where("i.course_id", "=", courseId)
        .orderBy("s.position")
        .orderBy("i.position")
        .execute(),
    ]);
    return { sections, items };
  }

  ratingBreakdown(courseId: string, exec: Executor = db) {
    return exec
      .selectFrom("reviews")
      .select(["rating", sql<number>`count(*)::int`.as("count")])
      .where("course_id", "=", courseId)
      .where("status", "=", "PUBLISHED")
      .groupBy("rating")
      .execute();
  }

  /** Users (instructors) with the profile fields an Instructor DTO adds. */
  instructorProfiles(ids: readonly string[], exec: Executor = db) {
    if (!ids.length) return Promise.resolve([]);
    return exec.selectFrom("users").select(["id", "bio", "website"]).where("id", "in", [...new Set(ids)]).execute();
  }

  reviews(courseId: string, opts: { rating?: number; cursor: TimeKey | null; limit: number }, exec: Executor = db) {
    let q = exec
      .selectFrom("reviews as r")
      .selectAll("r")
      .select(atKey("r.created_at"))
      .where("r.course_id", "=", courseId)
      .where("r.status", "=", "PUBLISHED");
    if (opts.rating) q = q.where("r.rating", "=", opts.rating);
    return q.where(olderThan("r.created_at", "r.id", opts.cursor)).orderBy("r.created_at", "desc").orderBy("r.id", "desc").limit(opts.limit + 1).execute();
  }

  // ─── Bundles ──────────────────────────────────────────────────────────────

  activeBundles(cursor: TimeKey | null, limit: number, exec: Executor = db) {
    return exec
      .selectFrom("bundles as b")
      .select(["b.id", "b.slug", "b.title", "b.description", "b.cover_upload_id"])
      .select(atKey("b.created_at"))
      .where("b.status", "=", "ACTIVE")
      .where(olderThan("b.created_at", "b.id", cursor))
      .orderBy("b.created_at", "desc")
      .orderBy("b.id", "desc")
      .limit(limit + 1)
      .execute();
  }

  bundleBySlug(slug: string, exec: Executor = db) {
    return exec.selectFrom("bundles").select(["id", "slug", "title", "description", "cover_upload_id"]).where("slug", "=", slug).where("status", "=", "ACTIVE").executeTakeFirst();
  }

  /** ACTIVE bundles that include a course (the course page's "also in" list). */
  bundlesWithCourse(courseId: string, exec: Executor = db) {
    return exec
      .selectFrom("bundles as b")
      .innerJoin("bundle_courses as bc", "bc.bundle_id", "b.id")
      .select(["b.id", "b.slug", "b.title", "b.description", "b.cover_upload_id"])
      .where("bc.course_id", "=", courseId)
      .where("b.status", "=", "ACTIVE")
      .orderBy("b.created_at", "desc")
      .execute();
  }

  /** The published courses of many bundles, in bundle order. */
  bundleCourses(bundleIds: readonly string[], exec: Executor = db) {
    if (!bundleIds.length) return Promise.resolve([]);
    return exec
      .selectFrom("bundle_courses as bc")
      .innerJoin("courses as c", "c.id", "bc.course_id")
      .select(["bc.bundle_id", "c.id as course_id"])
      .where("bc.bundle_id", "in", [...new Set(bundleIds)])
      .where("c.status", "=", "PUBLISHED")
      .orderBy("bc.bundle_id")
      .orderBy("bc.position")
      .execute();
  }

  // ─── Instructors ──────────────────────────────────────────────────────────

  /** A user listed on at least one published course, by username. */
  listedInstructor(username: string, exec: Executor = db) {
    return exec
      .selectFrom("users as u")
      .select(["u.id", "u.bio", "u.website"])
      .where("u.username", "=", username)
      .where("u.status", "in", ["ACTIVE", "SUSPENDED"])
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("course_staff as s")
            .innerJoin("courses as c", "c.id", "s.course_id")
            .select("s.course_id")
            .whereRef("s.user_id", "=", "u.id")
            .where("s.listed", "=", true)
            .where("c.status", "=", "PUBLISHED"),
        ),
      )
      .executeTakeFirst();
  }

  coursesTaughtBy(userId: string, exec: Executor = db): Promise<CardRow[]> {
    return exec
      .selectFrom("courses as c")
      .innerJoin("course_staff as s", "s.course_id", "c.id")
      .select([...CARD_COLUMNS])
      .where("s.user_id", "=", userId)
      .where("s.listed", "=", true)
      .where("c.status", "=", "PUBLISHED")
      .orderBy("c.enrollment_count", "desc")
      .orderBy("c.id", "desc")
      .limit(50)
      .execute() as Promise<CardRow[]>;
  }

  /** Whether any plan is on sale (a plan could unlock included courses). */
  async anyActivePlan(exec: Executor = db): Promise<boolean> {
    return !!(await exec.selectFrom("plans").select("id").where("status", "=", "ACTIVE").limit(1).executeTakeFirst());
  }

  /** The viewer's enrollment on one course, with what the course page shows. */
  enrollment(userId: string, courseId: string, exec: Executor = db) {
    return exec
      .selectFrom("enrollments")
      .select(["id", "source", "status", "progress_percent", "completed_at", "valid_until", "last_item_id"])
      .where("user_id", "=", userId)
      .where("course_id", "=", courseId)
      .executeTakeFirst();
  }

  async completedItemIds(userId: string, courseId: string, exec: Executor = db): Promise<Set<string>> {
    const rows = await exec.selectFrom("item_progress").select("item_id").where("user_id", "=", userId).where("course_id", "=", courseId).where("completed_at", "is not", null).execute();
    return new Set(rows.map((r) => r.item_id));
  }

  // ─── Wishlist ─────────────────────────────────────────────────────────────

  async save(userId: string, courseId: string, exec: Executor = db): Promise<void> {
    await exec.insertInto("saved_courses").values({ user_id: userId, course_id: courseId }).onConflict((oc) => oc.columns(["user_id", "course_id"]).doNothing()).execute();
  }

  async unsave(userId: string, courseId: string, exec: Executor = db): Promise<void> {
    await exec.deleteFrom("saved_courses").where("user_id", "=", userId).where("course_id", "=", courseId).execute();
  }
}

export const catalogRepo = new CatalogRepository();
