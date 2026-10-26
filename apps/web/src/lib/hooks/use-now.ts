"use client";

import { useEffect, useState } from "react";

/** A clock that ticks every `ms` so relative times stay fresh without a re-fetch. */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
