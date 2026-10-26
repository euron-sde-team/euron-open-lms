/**
 * Catalog DTOs other than the course card: bundles, the public curriculum
 * and categories. Everything is batched per response.
 *
 * The public curriculum carries titles, kinds, durations and the preview flag only:
 * no video reference, article body or PDF ever appears here (those go through
 * services/access.service.ts in the classroom).
 */
import type { BundleCard, Category, CurriculumSectionPublic, LectureKind } from "@open-lms/types";
import { db, type Executor } from "../db/kysely";
import { catalogRepo } from "../repositories/catalog.repository";
import { money, priceRepo } from "../repositories/price.repository";
import { loadMedia, urlOf } from "./media.presenter";

export interface BundleRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover_upload_id: string | null;
}

/** BundleCards in the given order, plus each bundle's published course ids (for details). */
export async function presentBundles(rows: readonly BundleRow[], currency: string, exec: Executor = db): Promise<{ cards: BundleCard[]; courseIds: Map<string, string[]> }> {
  const links = await catalogRepo.bundleCourses(rows.map((r) => r.id), exec);
  const courseIds = new Map<string, string[]>();
  for (const l of links) courseIds.set(l.bundle_id, [...(courseIds.get(l.bundle_id) ?? []), l.course_id]);
  const [bundlePrices, coursePrices, covers] = await Promise.all([
    priceRepo.oneTimeMany("BUNDLE", rows.map((r) => r.id), currency, exec),
    priceRepo.oneTimeMany("COURSE", links.map((l) => l.course_id), currency, exec),
    loadMedia(rows.map((r) => r.cover_upload_id), exec),
  ]);
  const cards = rows.map((r): BundleCard => {
    const ids = courseIds.get(r.id) ?? [];
    const priced = ids.map((id) => coursePrices.get(id)).filter((p) => !!p);
    const price = bundlePrices.get(r.id);
    return {
      id: r.id,
      slug: String(r.slug),
      title: r.title,
      description: r.description,
      coverUrl: urlOf(covers, r.cover_upload_id, "thumb"),
      courseCount: ids.length,
      price: price ? money(price.amount_minor, currency) : null,
      separately: priced.length ? money(priced.reduce((a, p) => a + p.amount_minor, 0), currency) : null,
    };
  });
  return { cards, courseIds };
}

export interface CurriculumRows {
  sections: { id: string; title: string }[];
  items: { id: string; section_id: string; kind: "LECTURE" | "QUIZ" | "ASSIGNMENT"; title: string; duration_seconds: number; is_preview: boolean; lecture_kind: LectureKind | null }[];
}

export function presentCurriculum(rows: CurriculumRows): CurriculumSectionPublic[] {
  return rows.sections.map((s) => {
    const items = rows.items
      .filter((i) => i.section_id === s.id)
      .map((i) => ({ id: i.id, kind: i.kind, title: i.title, lectureKind: i.kind === "LECTURE" ? i.lecture_kind : null, durationSeconds: i.duration_seconds, isPreview: i.is_preview }));
    return { id: s.id, title: s.title, items, durationSeconds: items.reduce((a, i) => a + i.durationSeconds, 0) };
  });
}

/** Lectures here are video lectures; articles and PDFs are counted on their own. */
export function curriculumCounts(items: CurriculumRows["items"]) {
  const counts = { lectures: 0, quizzes: 0, assignments: 0, articles: 0, pdfs: 0 };
  for (const i of items) {
    if (i.kind === "QUIZ") counts.quizzes += 1;
    else if (i.kind === "ASSIGNMENT") counts.assignments += 1;
    else if (i.lecture_kind === "ARTICLE") counts.articles += 1;
    else if (i.lecture_kind === "PDF") counts.pdfs += 1;
    else counts.lectures += 1;
  }
  return counts;
}

export function toCategory(r: { id: string; slug: string; name: string; description: string | null; course_count: number }): Category {
  return { id: r.id, slug: String(r.slug), name: r.name, description: r.description, courseCount: r.course_count };
}
