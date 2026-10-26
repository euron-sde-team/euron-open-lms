/** Catalog endpoints: browse, course pages, bundles, instructors, free enrollment and the wishlist. See docs/api/rest-contract.md. */
import type { BundleCard, BundleDetail, CatalogFacets, CatalogMinRating, CatalogSort, Category, CourseCard, CourseDetail, CourseLength, CourseLevel, Instructor, Page, Review } from "@open-lms/types";
import { enc, type Helpers, type PageQuery } from "./helpers";

export interface CatalogFilters {
  q?: string;
  /** A category slug. */
  category?: string;
  level?: CourseLevel;
  language?: string;
  price?: "free" | "paid" | "subscription";
  /** Average rating at least this; unrated courses are left out. */
  minRating?: CatalogMinRating;
  /** By total duration: short under 2 hours, medium 2 to 6 hours, long over 6 hours. */
  length?: CourseLength;
}

export interface CatalogQuery extends CatalogFilters, PageQuery {
  sort?: CatalogSort;
  /** Display currency (falls back to your preferred currency, then the academy default). */
  currency?: string;
}

export interface CatalogShelves {
  featured: CourseCard[];
  popular: CourseCard[];
  newest: CourseCard[];
  free: CourseCard[];
}

export function catalogEndpoints(h: Helpers) {
  const { pub, post, put, del, pq } = h;
  const cur = (currency?: string) => (currency ? { currency } : undefined);

  const catalog = {
    courses: (q?: CatalogQuery, signal?: AbortSignal) => pub<Page<CourseCard>>("/catalog/courses", pq(q), signal),
    facets: (q?: CatalogFilters, signal?: AbortSignal) => pub<CatalogFacets>("/catalog/facets", pq(q), signal),
    featured: (currency?: string) => pub<CatalogShelves>("/catalog/featured", cur(currency)),
    categories: () => pub<Category[]>("/catalog/categories"),
    course: (slug: string, currency?: string) => pub<CourseDetail>(`/catalog/courses/${enc(slug)}`, cur(currency)),
    reviews: (slug: string, q?: PageQuery & { rating?: number }) => pub<Page<Review>>(`/catalog/courses/${enc(slug)}/reviews`, pq(q)),
    bundles: (q?: PageQuery & { currency?: string }) => pub<Page<BundleCard>>("/catalog/bundles", pq(q)),
    bundle: (slug: string, currency?: string) => pub<BundleDetail>(`/catalog/bundles/${enc(slug)}`, cur(currency)),
    instructor: (username: string) => pub<{ instructor: Instructor; courses: CourseCard[] }>(`/catalog/instructors/${enc(username)}`),
    /** FREE courses only (403 NOT_FREE otherwise); returns the same enrollment when called again. */
    enrollFree: (slug: string) => post<{ enrollmentId: string; resumeItemId: string | null }>(`/catalog/courses/${enc(slug)}/enroll`, {}),
    save: (slug: string) => put(`/catalog/courses/${enc(slug)}/save`),
    unsave: (slug: string) => del(`/catalog/courses/${enc(slug)}/save`),
  };

  return { catalog };
}
