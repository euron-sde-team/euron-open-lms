"use client";

import { useEffect, useRef } from "react";

/**
 * Attach the returned ref to a sentinel element at the end (or start, for
 * chat history) of a list; `onReach` fires when it scrolls into view.
 */
export function useInfiniteScroll<T extends Element = HTMLDivElement>(
  onReach: () => void,
  { enabled = true, root = null, rootMargin = "600px 0px" }: { enabled?: boolean; root?: Element | null; rootMargin?: string } = {},
) {
  const ref = useRef<T | null>(null);
  const cb = useRef(onReach);
  cb.current = onReach;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { root, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, root, rootMargin]);

  return ref;
}
