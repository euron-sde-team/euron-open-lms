/**
 * The catalog's filters live in the URL (`/courses?category=data&level=beginner&price=free&rating=4&length=short&sort=newest&q=sql`),
 * so a filtered view survives a reload and can be shared. These helpers are pure: parse
 * whatever arrives (ignoring junk), serialise in a stable order, and turn the state into
 * the API query.
 */
import { CATALOG_MIN_RATINGS, COURSE_LENGTHS, COURSE_LEVELS, type CatalogFacets, type CatalogMinRating, type CatalogSort, type CourseLength, type CourseLevel } from "@open-lms/types";
import type { CatalogQuery } from "@open-lms/api-client";

export type PriceFilter = "free" | "paid" | "subscription";

export interface CatalogUrlState {
  q?: string;
  category?: string;
  level?: CourseLevel;
  language?: string;
  price?: PriceFilter;
  /** `rating=4` in the URL, `minRating` for the API. */
  minRating?: CatalogMinRating;
  length?: CourseLength;
  sort?: CatalogSort;
}

export const CATALOG_SORTS: { value: CatalogSort; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "popular", label: "Most popular" },
  { value: "newest", label: "Newest" },
  { value: "rating", label: "Highest rated" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

const SORT_VALUES = new Set<string>(CATALOG_SORTS.map((s) => s.value));
const PRICES = new Set<string>(["free", "paid", "subscription"]);
const LENGTHS = new Set<string>(COURSE_LENGTHS);
const SLUG = /^[a-z0-9-]{1,80}$/;
const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

type ParamSource = URLSearchParams | { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function read(src: ParamSource, key: string): string | undefined {
  let v: string | string[] | null | undefined;
  if (typeof (src as URLSearchParams).get === "function") v = (src as URLSearchParams).get(key);
  else v = (src as Record<string, string | string[] | undefined>)[key];
  if (Array.isArray(v)) v = v[0];
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : undefined;
}

/** "beginner" / "all-levels" in the URL; BEGINNER / ALL_LEVELS for the API. */
export function levelToParam(level: CourseLevel): string {
  return level.toLowerCase().replace(/_/g, "-");
}

export function levelFromParam(v: string | undefined): CourseLevel | undefined {
  if (!v) return undefined;
  const up = v.toUpperCase().replace(/-/g, "_");
  return (COURSE_LEVELS as readonly string[]).includes(up) ? (up as CourseLevel) : undefined;
}

/** "4" or "4.5" in the URL ("4.0" too); anything else is dropped. */
export function minRatingFromParam(v: string | undefined): CatalogMinRating | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return (CATALOG_MIN_RATINGS as readonly number[]).includes(n) ? (n as CatalogMinRating) : undefined;
}

/** The sort the API uses when none is given: best match while searching, else most popular. */
export function defaultSort(q: string | undefined): CatalogSort {
  return q?.trim() ? "relevance" : "popular";
}

/** Read the filters from URL params, dropping anything malformed. */
export function parseCatalogParams(src: ParamSource): CatalogUrlState {
  const out: CatalogUrlState = {};
  const q = read(src, "q");
  if (q) out.q = q.slice(0, 200);
  const category = read(src, "category")?.toLowerCase();
  if (category && SLUG.test(category)) out.category = category;
  const level = levelFromParam(read(src, "level"));
  if (level) out.level = level;
  const language = read(src, "language");
  if (language && LANG.test(language)) out.language = language.toLowerCase();
  const price = read(src, "price")?.toLowerCase();
  if (price && PRICES.has(price)) out.price = price as PriceFilter;
  const minRating = minRatingFromParam(read(src, "rating"));
  if (minRating) out.minRating = minRating;
  const length = read(src, "length")?.toLowerCase();
  if (length && LENGTHS.has(length)) out.length = length as CourseLength;
  const sort = read(src, "sort")?.toLowerCase();
  // "Best match" only means something while searching.
  if (sort && SORT_VALUES.has(sort) && !(sort === "relevance" && !out.q)) out.sort = sort as CatalogSort;
  if (out.sort && out.sort === defaultSort(out.q)) delete out.sort;
  return out;
}

/** Stable query string ("" when no filters), defaults omitted. */
export function serializeCatalogParams(state: CatalogUrlState): string {
  const p = new URLSearchParams();
  if (state.q?.trim()) p.set("q", state.q.trim());
  if (state.category) p.set("category", state.category);
  if (state.level) p.set("level", levelToParam(state.level));
  if (state.language) p.set("language", state.language);
  if (state.price) p.set("price", state.price);
  if (state.minRating) p.set("rating", String(state.minRating));
  if (state.length) p.set("length", state.length);
  if (state.sort && state.sort !== defaultSort(state.q) && !(state.sort === "relevance" && !state.q?.trim())) p.set("sort", state.sort);
  return p.toString();
}

/** `/courses?...` for a state. */
export function catalogHref(state: CatalogUrlState): string {
  const s = serializeCatalogParams(state);
  return s ? `/courses?${s}` : "/courses";
}

/** One filter changed (undefined clears it). Changing the query resets a sort that no longer applies. */
export function withFilter<K extends keyof CatalogUrlState>(state: CatalogUrlState, key: K, value: CatalogUrlState[K] | undefined): CatalogUrlState {
  const next: CatalogUrlState = { ...state };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  if (key === "q" && next.sort === "relevance" && !next.q) delete next.sort;
  return next;
}

/** Filters other than the search text and sort (what "Clear filters" removes). */
export function activeFilterCount(state: CatalogUrlState): number {
  return [state.category, state.level, state.language, state.price, state.minRating, state.length].filter(Boolean).length;
}

export function clearFilters(state: CatalogUrlState): CatalogUrlState {
  return state.q ? { q: state.q, ...(state.sort ? { sort: state.sort } : {}) } : {};
}

/** The API query for a page of results. */
export function toCatalogQuery(state: CatalogUrlState, currency?: string): CatalogQuery {
  const q: CatalogQuery = {};
  if (state.q) q.q = state.q;
  if (state.category) q.category = state.category;
  if (state.level) q.level = state.level;
  if (state.language) q.language = state.language;
  if (state.price) q.price = state.price;
  if (state.minRating) q.minRating = state.minRating;
  if (state.length) q.length = state.length;
  q.sort = state.sort ?? defaultSort(state.q);
  if (currency) q.currency = currency;
  return q;
}

/**
 * How many courses match. Facets ignore their own dimension (picking a level keeps the
 * other levels visible), and every course has exactly one level, so the total is the
 * selected level's count or the sum of all levels.
 */
export function resultTotal(facets: CatalogFacets | undefined, state: CatalogUrlState): number | null {
  if (!facets) return null;
  if (state.level) return facets.levels[state.level] ?? 0;
  return Object.values(facets.levels).reduce((a, b) => a + b, 0);
}
