"use client";

/**
 * The display currency for catalog prices. Precedence: a choice the viewer made in the
 * currency menu (localStorage `lms:currency`), then their account's preferred currency,
 * then the academy default. Only currencies the academy sells in are ever used.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { AcademyMeta, Me } from "@open-lms/types";
import { useAuth } from "./auth";
import { useAcademyMeta } from "./meta";

export const CURRENCY_STORAGE_KEY = "lms:currency";

/** Pure resolver, shared by the hook and the tests. */
export function resolveDisplayCurrency(
  meta: Pick<AcademyMeta, "currencies" | "defaultCurrency"> | null | undefined,
  user: Pick<Me, "preferredCurrency"> | null | undefined,
  stored: string | null | undefined,
): string | undefined {
  if (!meta) return stored?.toUpperCase() || user?.preferredCurrency || undefined;
  const offered = new Set(meta.currencies.map((c) => c.toUpperCase()));
  const pick = (c: string | null | undefined) => (c && offered.has(c.toUpperCase()) ? c.toUpperCase() : undefined);
  return pick(stored) ?? pick(user?.preferredCurrency) ?? meta.defaultCurrency;
}

const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(CURRENCY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === CURRENCY_STORAGE_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * `{ currency, currencies, setCurrency, ready }`. Gate price queries on `ready` (the academy
 * meta has loaded or failed) so a page does not fetch twice; if meta failed, `currency` is
 * undefined and the API falls back to the viewer's preference.
 */
export function useDisplayCurrency() {
  const { data: meta, isError } = useAcademyMeta();
  const { user } = useAuth();
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const currency = resolveDisplayCurrency(meta, user, stored);
  const setCurrency = useCallback((c: string) => {
    try {
      window.localStorage.setItem(CURRENCY_STORAGE_KEY, c.toUpperCase());
    } catch {
      /* private mode: the choice lasts for this render only */
    }
    listeners.forEach((l) => l());
  }, []);
  return { currency, currencies: meta?.currencies ?? [], setCurrency, ready: !!meta || isError };
}
