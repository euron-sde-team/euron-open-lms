import type { MetadataRoute } from "next";
import { publicOrigin, serverGet } from "@/lib/server-api";

type Entry = { path: string; updatedAt: string };
type SitemapPage = { items: Entry[]; nextCursor: string | null };

// A single sitemap file may list at most 50,000 URLs; stay well under it.
const MAX_PER_TYPE = 15_000;

async function all(type: "courses" | "bundles" | "instructors"): Promise<Entry[]> {
  const out: Entry[] = [];
  let cursor: string | null = null;
  do {
    const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page: SitemapPage | null = await serverGet<SitemapPage>(`/meta/sitemap?type=${type}${qs}`, 600);
    if (!page) break;
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && out.length < MAX_PER_TYPE);
  return out.slice(0, MAX_PER_TYPE);
}

export const revalidate = 600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await publicOrigin();
  const [courses, bundles, instructors] = await Promise.all([all("courses"), all("bundles"), all("instructors")]);
  const fixed: MetadataRoute.Sitemap = ["/", "/courses", "/bundles", "/plans"].map((p) => ({ url: `${origin}${p}`, changeFrequency: "daily", priority: p === "/" ? 1 : 0.8 }));
  const dyn = (list: Entry[], priority: number): MetadataRoute.Sitemap => list.map((e) => ({ url: `${origin}${e.path}`, lastModified: e.updatedAt, priority }));
  return [...fixed, ...dyn(courses, 0.9), ...dyn(bundles, 0.7), ...dyn(instructors, 0.5)];
}
