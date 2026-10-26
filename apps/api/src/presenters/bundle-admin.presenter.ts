/** Bundle rows to `AdminBundle`: course ids in order, active prices, the cover. */
import type { AdminBundle } from "@open-lms/types";
import type { Selectable } from "kysely";
import { db, type Executor } from "../db/kysely";
import type { Bundles } from "../db/types";
import { loadMedia } from "./media.presenter";
import { activePrices, toAdminPrice } from "./plan.presenter";

export type BundleRow = Selectable<Bundles>;

export async function presentAdminBundles(rows: BundleRow[], exec: Executor = db): Promise<AdminBundle[]> {
  if (!rows.length) return [];
  const ids = rows.map((b) => b.id);
  const [courses, prices, media] = await Promise.all([
    exec.selectFrom("bundle_courses").select(["bundle_id", "course_id"]).where("bundle_id", "in", ids).orderBy("bundle_id").orderBy("position").execute(),
    activePrices("BUNDLE", ids, exec),
    loadMedia(rows.map((b) => b.cover_upload_id), exec),
  ]);
  const byBundle = new Map<string, string[]>();
  for (const c of courses) byBundle.set(c.bundle_id, [...(byBundle.get(c.bundle_id) ?? []), c.course_id]);
  return rows.map((b) => ({
    id: b.id,
    slug: String(b.slug),
    title: b.title,
    description: b.description,
    cover: b.cover_upload_id ? (media.get(b.cover_upload_id) ?? null) : null,
    status: b.status,
    courseIds: byBundle.get(b.id) ?? [],
    prices: (prices.get(b.id) ?? []).map(toAdminPrice),
  }));
}
