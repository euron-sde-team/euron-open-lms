"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { flattenPages, nextCursor } from "@open-lms/api-client";
import { COURSE_LEVELS, type CatalogFacets, type CatalogSort, type CourseLevel } from "@open-lms/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  NativeSelect,
  Sheet,
  SheetContent,
  Spinner,
  cn,
} from "@open-lms/ui";
import { CourseCard, CourseCardSkeleton, CourseGrid } from "@/components/course/course-card";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  CATALOG_SORTS,
  activeFilterCount,
  catalogHref,
  clearFilters,
  defaultSort,
  parseCatalogParams,
  resultTotal,
  toCatalogQuery,
  withFilter,
  type CatalogUrlState,
  type PriceFilter,
} from "@/lib/catalog-filters";
import { useDisplayCurrency } from "@/lib/currency";
import { languageName, levelLabel } from "@/lib/duration";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useInfiniteScroll } from "@/lib/hooks/use-infinite-scroll";
import { useSaveCourse } from "@/lib/hooks/use-save-course";
import { useAcademyMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { CurrencyMenu } from "./currency-menu";

const PRICE_LABELS: Record<PriceFilter, string> = { free: "Free", paid: "Paid", subscription: "In plans" };

/** /courses: search, URL filters, facet counts and a keyset grid. */
export function CatalogPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = useMemo(() => parseCatalogParams(params), [params]);
  const { status } = useAuth();
  const { currency, ready } = useDisplayCurrency();
  const { data: meta } = useAcademyMeta();
  const { toggle } = useSaveCourse();
  const [sheetOpen, setSheetOpen] = useState(false);

  const go = (next: CatalogUrlState) => router.replace(catalogHref(next), { scroll: false });
  const set = <K extends keyof CatalogUrlState>(key: K, value: CatalogUrlState[K] | undefined) => go(withFilter(state, key, value));

  // Search box: local text, debounced into the URL.
  const [text, setText] = useState(state.q ?? "");
  useEffect(() => setText(state.q ?? ""), [state.q]);
  const debounced = useDebounced(text, 350);
  useEffect(() => {
    if (pathname !== "/courses") return;
    if ((debounced.trim() || undefined) !== state.q) go(withFilter(state, "q", debounced.trim() || undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const filters = { q: state.q, category: state.category, level: state.level, language: state.language, price: state.price };
  const facets = useQuery({
    queryKey: qk.facets(filters),
    queryFn: ({ signal }) => api().catalog.facets(filters, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    meta: { silent: true },
  });

  const listKey = { ...state, sort: state.sort ?? defaultSort(state.q), currency: currency ?? "" };
  const list = useInfiniteQuery({
    queryKey: qk.catalog(listKey),
    queryFn: ({ pageParam, signal }) => api().catalog.courses({ ...toCatalogQuery(state, currency), cursor: pageParam, limit: 24 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    placeholderData: keepPreviousData,
    enabled: ready && status !== "loading",
  });
  const courses = flattenPages(list.data?.pages);
  const [autoLoad, setAutoLoad] = useState(false);
  const sentinel = useInfiniteScroll<HTMLDivElement>(
    () => {
      if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
    },
    { enabled: autoLoad && !!list.hasNextPage },
  );
  useEffect(() => setAutoLoad(false), [params]);

  const total = resultTotal(facets.data, state);
  const nFilters = activeFilterCount(state);
  const sort = state.sort ?? defaultSort(state.q);
  const sorts = CATALOG_SORTS.filter((s) => s.value !== "relevance" || state.q);
  const showSubscription = !!meta?.subscriptions || (facets.data?.price.subscription ?? 0) > 0;

  const categoryTabs = [
    { value: "", label: "All", href: catalogHref(withFilter(state, "category", undefined)) },
    ...(facets.data?.categories ?? []).map((c) => ({ value: c.slug, label: c.name, count: c.count, href: catalogHref(withFilter(state, "category", c.slug)) })),
  ];
  // Keep a selected category visible even if its facet count dropped to zero.
  if (state.category && !categoryTabs.some((t) => t.value === state.category)) categoryTabs.push({ value: state.category, label: state.category.replace(/-/g, " "), href: catalogHref(state) });

  return (
    <main id="main" className="min-w-0 pb-16">
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-8 sm:px-6">
        <h1 className="font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[40px]">{state.q ? <>Results for &ldquo;{state.q}&rdquo;</> : "Courses"}</h1>
        <form
          role="search"
          className="relative mt-5 max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            go(withFilter(state, "q", text.trim() || undefined));
          }}
        >
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by topic, skill or instructor" aria-label="Search courses" className="h-12 pl-11 text-[15px]" data-testid="catalog-search" />
        </form>
      </div>

      {/* Sticky filter bar */}
      <div className="sticky top-header z-30 mt-6 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1200px] items-end gap-4 px-4 pt-3 sm:px-6">
          <UnderlineTabs label="Category" tabs={categoryTabs} value={state.category ?? ""} className="min-w-0 flex-1 border-b-0" size="sm" />
          <div className="hidden shrink-0 items-center gap-1 pb-1.5 md:flex">
            <FilterMenu<CourseLevel>
              label="Level"
              value={state.level}
              options={COURSE_LEVELS.map((l) => ({ value: l, label: levelLabel(l), count: facets.data?.levels[l] ?? null }))}
              onChange={(v) => set("level", v)}
              testId="filter-level"
            />
            <FilterMenu<string>
              label="Language"
              value={state.language}
              options={(facets.data?.languages ?? []).map((l) => ({ value: l.code, label: languageName(l.code), count: l.count }))}
              onChange={(v) => set("language", v)}
              testId="filter-language"
            />
            <FilterMenu<PriceFilter>
              label="Price"
              value={state.price}
              options={priceOptions(facets.data, showSubscription)}
              onChange={(v) => set("price", v)}
              testId="filter-price"
            />
          </div>
          <Button variant="ghost" size="sm" className="mb-1.5 shrink-0 md:hidden" onClick={() => setSheetOpen(true)} data-testid="filters-open">
            <SlidersHorizontal /> Filters{nFilters - (state.category ? 1 : 0) > 0 ? <span className="tabular-nums text-muted-foreground">{nFilters - (state.category ? 1 : 0)}</span> : null}
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 py-5">
          <p className="text-[13.5px] text-muted-foreground" aria-live="polite" data-testid="catalog-count">
            {total == null ? " " : total === 1 ? "1 course" : `${total.toLocaleString()} courses`}
            {nFilters > 0 ? (
              <>
                {" · "}
                <button type="button" className="font-semibold text-link hover:underline" onClick={() => go(clearFilters(state))} data-testid="filters-clear">
                  Clear filters
                </button>
              </>
            ) : null}
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor="catalog-sort" className="text-[13px] text-muted-foreground">
              Sort
            </label>
            <NativeSelect id="catalog-sort" value={sort} onChange={(e) => set("sort", e.target.value as CatalogSort)} className="h-9 w-auto min-w-[170px] text-[13.5px]" data-testid="catalog-sort">
              {sorts.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            <CurrencyMenu />
          </div>
        </div>

        <ActiveFilters state={state} onClear={(k) => set(k, undefined)} />

        {list.isError && !courses.length ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : list.isPending ? (
          <CourseGrid>
            {Array.from({ length: 8 }, (_, i) => (
              <CourseCardSkeleton key={i} />
            ))}
          </CourseGrid>
        ) : courses.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={state.q ? `No courses match "${state.q}"` : "No courses match these filters"}
            description={nFilters ? "Try clearing a filter or two." : "Try a different word, or browse every course."}
            action={
              nFilters ? (
                <Button variant="outline" onClick={() => go(clearFilters(state))}>
                  Clear filters
                </Button>
              ) : state.q ? (
                <Button variant="outline" onClick={() => go({})}>
                  Browse all courses
                </Button>
              ) : undefined
            }
            className="py-20"
          />
        ) : (
          <>
            <CourseGrid className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
              {courses.map((c) => (
                <CourseCard key={c.id} course={c} onToggleSave={toggle} />
              ))}
            </CourseGrid>
            <div ref={sentinel} className="flex min-h-16 items-center justify-center pt-10">
              {list.isFetchingNextPage ? (
                <Spinner />
              ) : list.hasNextPage ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setAutoLoad(true);
                    void list.fetchNextPage();
                  }}
                  data-testid="catalog-more"
                >
                  Load more courses
                </Button>
              ) : courses.length > 12 ? (
                <p className="text-[13px] text-subtle-foreground">That is every course that matches.</p>
              ) : null}
            </div>
          </>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" width="max-w-sm" aria-describedby={undefined}>
          <FiltersSheet state={state} facets={facets.data} showSubscription={showSubscription} onPick={(k, v) => set(k, v)} onDone={() => setSheetOpen(false)} onClear={() => go(clearFilters(state))} />
        </SheetContent>
      </Sheet>
    </main>
  );
}

function priceOptions(f: CatalogFacets | undefined, showSubscription: boolean) {
  const opts: { value: PriceFilter; label: string; count: number | null }[] = [
    { value: "free", label: PRICE_LABELS.free, count: f?.price.free ?? null },
    { value: "paid", label: PRICE_LABELS.paid, count: f?.price.paid ?? null },
  ];
  if (showSubscription) opts.push({ value: "subscription", label: PRICE_LABELS.subscription, count: f?.price.subscription ?? null });
  return opts;
}

interface Opt<V extends string> {
  value: V;
  label: string;
  count: number | null;
}

/** A filter as a word with a menu ("Level" / "Beginner"), counts as quiet numbers. */
function FilterMenu<V extends string>({ label, value, options, onChange, testId }: { label: string; value: V | undefined; options: Opt<V>[]; onChange: (v: V | undefined) => void; testId: string }) {
  const current = options.find((o) => o.value === value);
  if (!options.length && !value) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-[13.5px] font-medium hover:bg-muted", value ? "text-foreground" : "text-muted-foreground")}
          aria-label={current ? `${label}: ${current.label}` : `Filter by ${label.toLowerCase()}`}
          data-testid={testId}
        >
          {current ? current.label : label}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(v) => onChange((v || undefined) as V | undefined)}>
          <DropdownMenuRadioItem value="">Any {label.toLowerCase()}</DropdownMenuRadioItem>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} disabled={o.count === 0 && o.value !== value}>
              <span className="flex-1">{o.label}</span>
              {o.count != null ? <span className="tabular-nums text-subtle-foreground">{o.count}</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The chosen filters (other than the category, which the tabs show) as words you can remove. */
function ActiveFilters({ state, onClear }: { state: CatalogUrlState; onClear: (k: "level" | "language" | "price") => void }) {
  const items: { key: "level" | "language" | "price"; label: string }[] = [];
  if (state.level) items.push({ key: "level", label: levelLabel(state.level) });
  if (state.language) items.push({ key: "language", label: languageName(state.language) });
  if (state.price) items.push({ key: "price", label: PRICE_LABELS[state.price] });
  if (!items.length) return null;
  return (
    <ul className="-mt-2 mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px]" aria-label="Active filters">
      {items.map((i) => (
        <li key={i.key}>
          <button type="button" onClick={() => onClear(i.key)} className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary" aria-label={`Remove filter ${i.label}`}>
            {i.label} <X className="size-3.5 text-subtle-foreground" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Phones: every filter in one sheet, as plain radio rows with counts. */
function FiltersSheet({
  state,
  facets,
  showSubscription,
  onPick,
  onDone,
  onClear,
}: {
  state: CatalogUrlState;
  facets: CatalogFacets | undefined;
  showSubscription: boolean;
  onPick: <K extends "level" | "language" | "price">(k: K, v: CatalogUrlState[K] | undefined) => void;
  onDone: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-4 pr-12">
        <h2 className="font-display text-[20px] font-semibold">Filters</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
        <RadioRows
          legend="Level"
          name="sheet-level"
          value={state.level ?? ""}
          options={COURSE_LEVELS.map((l) => ({ value: l, label: levelLabel(l), count: facets?.levels[l] ?? null }))}
          onChange={(v) => onPick("level", (v || undefined) as CourseLevel | undefined)}
        />
        <RadioRows
          legend="Price"
          name="sheet-price"
          value={state.price ?? ""}
          options={priceOptions(facets, showSubscription)}
          onChange={(v) => onPick("price", (v || undefined) as PriceFilter | undefined)}
        />
        {facets?.languages.length ? (
          <RadioRows
            legend="Language"
            name="sheet-language"
            value={state.language ?? ""}
            options={facets.languages.map((l) => ({ value: l.code, label: languageName(l.code), count: l.count }))}
            onChange={(v) => onPick("language", v || undefined)}
          />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        <Button variant="ghost" onClick={onClear}>
          Clear all
        </Button>
        <Button onClick={onDone} data-testid="filters-done">
          Show courses
        </Button>
      </div>
    </div>
  );
}

function RadioRows({ legend, name, value, options, onChange }: { legend: string; name: string; value: string; options: Opt<string>[]; onChange: (v: string) => void }) {
  const all = [{ value: "", label: `Any ${legend.toLowerCase()}`, count: null }, ...options];
  return (
    <fieldset>
      <legend className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">{legend}</legend>
      <div className="divide-y divide-border">
        {all.map((o) => (
          <label key={o.value || "any"} className="flex cursor-pointer items-center gap-3 py-3 text-[15px]">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="size-4 accent-[hsl(var(--primary))]" />
            <span className={cn("flex-1", value === o.value ? "font-semibold text-foreground" : "text-foreground")}>{o.label}</span>
            {o.count != null ? <span className="text-[13px] tabular-nums text-subtle-foreground">{o.count}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

