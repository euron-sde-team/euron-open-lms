/**
 * CourseCard DTOs, batched. `presentCards` takes every card row of a response and
 * loads instructors, categories, covers, prices (in one display currency) and the
 * viewer's saved / enrolled / progress state with one query each.
 *
 * Rules:
 *   - price is the active one-time COURSE price in the display currency, and null for
 *     FREE and SUBSCRIPTION_ONLY courses (they are never sold on their own);
 *   - rating is null until the course has a rating; the average has one decimal;
 *   - `viewer` is null when signed out. `enrolled` means the enrollment grants access
 *     right now (active, not expired; subscription rows only while the plan does).
 *
 * The display currency (`displayCurrency`): `?currency=` when the academy sells in it,
 * else the viewer's preferred currency when it does, else the academy default.
 */
import type { CourseCard, Money, UserSummary } from "@open-lms/types";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import { courseCardRepo, type CardRow } from "../repositories/course-card.repository";
import { money, priceRepo, type PriceRow } from "../repositories/price.repository";
import { hasPlanAccess } from "../services/access.service";
import { getSettings } from "../services/settings.service";
import { loadMedia, urlOf } from "./media.presenter";
import { loadSummaries } from "./user.presenter";

/** Pick the currency prices are shown in for this request. */
export async function displayCurrency(viewer: Actor | null, requested: string | null | undefined, exec: Executor = db): Promise<string> {
  const settings = await getSettings(exec);
  const enabled = new Set(settings.currencies.enabled.map((c) => c.toUpperCase()));
  const wanted = requested?.toUpperCase();
  if (wanted && enabled.has(wanted)) return wanted;
  if (viewer) {
    const pref = (await courseCardRepo.preferredCurrency(viewer.id, exec))?.preferred_currency?.toUpperCase();
    if (pref && enabled.has(pref)) return pref;
  }
  return settings.currencies.default.toUpperCase();
}

/** The average with one decimal, or null when nobody rated the course yet. */
export function ratingOf(row: Pick<CardRow, "rating_count" | "rating_sum">): CourseCard["rating"] {
  if (!row.rating_count) return null;
  return { average: Math.round((row.rating_sum / row.rating_count) * 10) / 10, count: row.rating_count };
}

/** The sale price of a card: only PAID courses carry one. */
export function cardPrice(row: Pick<CardRow, "access_mode">, price: PriceRow | undefined): { price: Money | null; compareAt: Money | null } {
  if (row.access_mode !== "PAID" || !price) return { price: null, compareAt: null };
  return {
    price: money(price.amount_minor, price.currency),
    compareAt: price.compare_at_minor !== null && price.compare_at_minor > price.amount_minor ? money(price.compare_at_minor, price.currency) : null,
  };
}

export interface CardContext {
  viewer: Actor | null;
  currency: string;
}

export interface PresentedCards {
  cards: Map<string, CourseCard>;
  /** The raw price rows (the course page needs them for its access state). */
  prices: Map<string, PriceRow>;
  /** Instructor user ids per course, in order (the course page loads their bios). */
  instructorIds: Map<string, string[]>;
}

/** Present many card rows at once. The map is keyed by course id; callers keep their order. */
export async function presentCardMap(rows: readonly CardRow[], ctx: CardContext, exec: Executor = db): Promise<PresentedCards> {
  const ids = rows.map((r) => r.id);
  const now = new Date();
  const [staff, categories, prices, covers, saved, enrollments] = await Promise.all([
    courseCardRepo.instructors(ids, exec),
    courseCardRepo.categories(ids, exec),
    priceRepo.oneTimeMany("COURSE", rows.filter((r) => r.access_mode === "PAID").map((r) => r.id), ctx.currency, exec),
    loadMedia(rows.map((r) => r.cover_upload_id), exec),
    ctx.viewer ? courseCardRepo.savedIds(ctx.viewer.id, ids, exec) : Promise.resolve([]),
    ctx.viewer ? courseCardRepo.enrollments(ctx.viewer.id, ids, exec) : Promise.resolve([]),
  ]);
  const people = await loadSummaries(staff.map((s) => s.user_id), exec);
  const planActive = ctx.viewer && enrollments.some((e) => e.source === "SUBSCRIPTION" && e.status === "ACTIVE") ? await hasPlanAccess(ctx.viewer.id, exec) : false;

  const instructorIds = new Map<string, string[]>();
  for (const s of staff) instructorIds.set(s.course_id, [...(instructorIds.get(s.course_id) ?? []), s.user_id]);
  const cats = new Map<string, { slug: string; name: string }[]>();
  for (const c of categories) cats.set(c.course_id, [...(cats.get(c.course_id) ?? []), { slug: String(c.slug), name: c.name }]);
  const savedSet = new Set(saved.map((s) => s.course_id));
  const enrolledBy = new Map(enrollments.map((e) => [e.course_id, e]));

  const cards = new Map<string, CourseCard>();
  for (const r of rows) {
    const e = enrolledBy.get(r.id);
    const live = !!e && e.status === "ACTIVE" && (e.source === "SUBSCRIPTION" ? planActive : !e.valid_until || e.valid_until > now);
    cards.set(r.id, {
      id: r.id,
      slug: String(r.slug),
      title: r.title,
      subtitle: r.subtitle,
      coverUrl: urlOf(covers, r.cover_upload_id, "thumb"),
      level: r.level,
      language: r.language,
      accessMode: r.access_mode,
      includedInSubscription: r.included_in_subscription,
      instructors: (instructorIds.get(r.id) ?? []).map((id) => people.get(id)).filter((p): p is UserSummary => !!p),
      categories: cats.get(r.id) ?? [],
      itemCount: r.item_count,
      durationSeconds: r.duration_seconds,
      enrollmentCount: r.enrollment_count,
      rating: ratingOf(r),
      ...cardPrice(r, prices.get(r.id)),
      featured: r.featured,
      publishedAt: r.published_at?.toISOString() ?? null,
      viewer: ctx.viewer ? { saved: savedSet.has(r.id), enrolled: live, progressPercent: e ? e.progress_percent : null } : null,
    });
  }
  return { cards, prices, instructorIds };
}

/** Present card rows in the order given. */
export async function presentCards(rows: readonly CardRow[], ctx: CardContext, exec: Executor = db): Promise<CourseCard[]> {
  const { cards } = await presentCardMap(rows, ctx, exec);
  return rows.map((r) => cards.get(r.id)).filter((c): c is CourseCard => !!c);
}
