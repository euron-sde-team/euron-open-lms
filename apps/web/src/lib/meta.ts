"use client";

import { useQuery } from "@tanstack/react-query";
import type { AcademyMeta } from "@open-lms/types";
import { api } from "./api";
import { qk } from "./query-keys";
import { productName } from "./runtime-env";

/** The academy's own name (set by an admin) wins over the deployment's PRODUCT_NAME. */
export function resolveProductName(meta: Pick<AcademyMeta, "academyName"> | null | undefined, fallback: string): string {
  const name = meta?.academyName?.trim();
  return name || fallback;
}

/** Public facts about the academy (name, currencies, gateways, registration). Readable signed out; cached for minutes. */
export function useAcademyMeta() {
  return useQuery({
    queryKey: qk.meta,
    queryFn: ({ signal }) => api().meta.get(signal),
    staleTime: 5 * 60_000,
    retry: 1,
    meta: { silent: true },
  });
}

/** The product title to show: the academy name when set, else the runtime PRODUCT_NAME. */
export function useProductName(): string {
  const { data } = useAcademyMeta();
  return resolveProductName(data, productName());
}
