import type { Page } from "@open-lms/types";

/** `getNextPageParam` for TanStack infinite queries over `Page<T>`. */
export const nextCursor = <T>(last: Page<T>): string | undefined => last.nextCursor ?? undefined;

/** Flatten infinite-query pages into one list, dropping duplicates by id (cursor overlap, live inserts). */
export function flattenPages<T extends { id: string }>(pages: readonly Page<T>[] | undefined): T[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of pages) {
    for (const item of p.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/** Flatten pages whose items have no id (reaction lists, attendee rows). */
export function flattenAll<T>(pages: readonly Page<T>[] | undefined): T[] {
  return pages ? pages.flatMap((p) => p.items) : [];
}

/**
 * Walk a cursor-paginated endpoint until it is exhausted or `max` items are
 * collected. For small lists that a screen needs in full.
 */
export async function collectPages<T>(fetchPage: (cursor: string | undefined) => Promise<Page<T>>, max = 500): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    if (!page.nextCursor || out.length >= max) break;
    if (page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return out.slice(0, max);
}

/** Apply `fn` to every item across pages (cache surgery for optimistic updates). */
export function mapPages<T>(pages: readonly Page<T>[], fn: (item: T) => T): Page<T>[] {
  return pages.map((p) => ({ ...p, items: p.items.map(fn) }));
}

/** Remove items matching `pred` across pages. */
export function filterPages<T>(pages: readonly Page<T>[], pred: (item: T) => boolean): Page<T>[] {
  return pages.map((p) => ({ ...p, items: p.items.filter(pred) }));
}
