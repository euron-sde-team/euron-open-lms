"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "@open-lms/ui";
import type { CourseCard } from "@open-lms/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { qk } from "../query-keys";

/** Caches that hold course cards (lists, shelves, the course page, bundles, instructors). */
const CARD_CACHES = new Set<string>(["catalog", "featured", "course", "bundle", "instructor"]);

/**
 * Return `data` with `viewer.saved` set on every course object whose slug matches,
 * keeping object identity where nothing changed (so unrelated rows do not re-render).
 */
export function patchSaved<T>(data: T, slug: string, saved: boolean): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => {
        const n = walk(x);
        if (n !== x) changed = true;
        return n;
      });
      return changed ? out : v;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (o.slug === slug && "viewer" in o && o.viewer && typeof o.viewer === "object") {
        const viewer = o.viewer as CourseCard["viewer"] & object;
        return viewer.saved === saved ? v : { ...o, viewer: { ...viewer, saved } };
      }
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(o)) {
        const n = walk(x);
        if (n !== x) changed = true;
        out[k] = n;
      }
      return changed ? out : v;
    }
    return v;
  };
  return walk(data) as T;
}

/**
 * Save / unsave a course (the wishlist), optimistic everywhere the card is cached.
 * Signed out, the toggle sends the visitor to sign in and come back.
 */
export function useSaveCourse() {
  const qc = useQueryClient();
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const mutation = useMutation({
    mutationFn: ({ slug, saved }: { slug: string; saved: boolean }) => (saved ? api().catalog.save(slug) : api().catalog.unsave(slug)),
    onMutate: async ({ slug, saved }) => {
      const predicate = (q: { queryKey: QueryKey }) => CARD_CACHES.has(String(q.queryKey[0]));
      await qc.cancelQueries({ predicate });
      const snapshot = qc.getQueriesData({ predicate });
      for (const [key, data] of snapshot) if (data !== undefined) qc.setQueryData(key, patchSaved(data, slug, saved));
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSuccess: (_d, { saved }) => {
      void qc.invalidateQueries({ queryKey: qk.mySaved });
      toast.success({ title: saved ? "Saved for later" : "Removed from saved" });
    },
  });

  const toggle = useCallback(
    (course: Pick<CourseCard, "slug" | "viewer">) => {
      if (status !== "signed-in") {
        router.push(`/login?next=${encodeURIComponent(pathname || "/courses")}`);
        return;
      }
      mutation.mutate({ slug: course.slug, saved: !course.viewer?.saved });
    },
    [status, router, pathname, mutation],
  );

  return { toggle, pending: mutation.isPending };
}
