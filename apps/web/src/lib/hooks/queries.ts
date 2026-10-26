"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { nextCursor } from "@open-lms/api-client";
import type { Page } from "@open-lms/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { qk } from "../query-keys";
import { useInfiniteScroll } from "./use-infinite-scroll";

/** The unread notification badge, refreshed every two minutes while signed in. */
export function useCounts() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.counts,
    queryFn: () => api().notifications.counts(),
    enabled: status === "signed-in",
    staleTime: 60_000,
    refetchInterval: 120_000,
    meta: { silent: true },
  });
}

/**
 * The standard infinite list over a Page<T> endpoint, with the sentinel ref
 * for IntersectionObserver-driven loading. Items need a stable key: pass `keyOf`
 * when the rows have no `id`.
 */
export function usePagedList<T>(opts: {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>;
  enabled?: boolean;
  staleTime?: number;
  /** De-duplicates rows across pages; defaults to `id` when rows have one. */
  keyOf?: (item: T) => string;
}) {
  const query = useInfiniteQuery({
    queryKey: opts.queryKey,
    queryFn: ({ pageParam }) => opts.fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: opts.enabled ?? true,
    staleTime: opts.staleTime,
  });
  const items = flattenKeyed(query.data?.pages, opts.keyOf);
  const sentinelRef = useInfiniteScroll<HTMLDivElement>(
    () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    { enabled: !!query.hasNextPage },
  );
  return { ...query, items, sentinelRef };
}

/**
 * Pages into one list. Rows are de-duplicated by key (a row can move between pages while
 * the list changes); rows with no key are all kept, never collapsed into one.
 */
export function flattenKeyed<T>(pages: readonly Page<T>[] | undefined, keyOf?: (item: T) => string): T[] {
  if (!pages) return [];
  const key = keyOf ?? ((item: T) => (item as { id?: unknown }).id as string | undefined);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of pages) {
    for (const item of p.items) {
      const k = key(item);
      if (k !== undefined && k !== null) {
        if (seen.has(k)) continue;
        seen.add(k);
      }
      out.push(item);
    }
  }
  return out;
}
