"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button, EmptyState, Skeleton, Spinner, cn } from "@open-lms/ui";
import { ErrorState } from "@/components/common/states";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Client-side sorting value; makes the header a sort button. */
  sortValue?: (row: T) => string | number | null;
  /** Show a sort button (default: when `sortValue` is set). With controlled `sort`, the server sorts. */
  sortable?: boolean;
  align?: "left" | "right";
  /** Hide on narrow screens. */
  hideBelow?: "sm" | "md" | "lg";
  /** Width / extra classes for the th and td. */
  className?: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Accessible table name. */
  caption: string;
  onRowClick?: (row: T) => void;
  /** Highlights the row whose detail is open. */
  selectedKey?: string | null;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode };
  /** Keyset pagination: shows "Load more" while `hasMore`. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Controlled sorting (server-side). Without it, columns with `sortValue` sort on the client. */
  sort?: SortState | null;
  onSortChange?: (s: SortState | null) => void;
  skeletonRows?: number;
  testId?: string;
  rowTestId?: (row: T) => string;
  className?: string;
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;

/** Next sort for a header click: asc, desc, then off. */
export function nextSort(cur: SortState | null | undefined, key: string): SortState | null {
  if (!cur || cur.key !== key) return { key, dir: "asc" };
  return cur.dir === "asc" ? { key, dir: "desc" } : null;
}

export function sortRows<T>(rows: T[], sort: SortState | null | undefined, columns: Column<T>[]): T[] {
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
  if (!sort || !col?.sortValue) return rows;
  const get = col.sortValue;
  const m = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * m;
  });
}

/** Hairline rows, optional sortable headers, keyset "Load more", empty state and row click. */
export function DataTable<T>(p: DataTableProps<T>) {
  const [localSort, setLocalSort] = useState<SortState | null>(null);
  const controlled = p.onSortChange !== undefined;
  const sort = controlled ? p.sort ?? null : localSort;
  const rows = useMemo(() => (controlled ? p.rows : sortRows(p.rows, localSort, p.columns)), [controlled, p.rows, localSort, p.columns]);
  const setSort = (s: SortState | null) => (controlled ? p.onSortChange?.(s) : setLocalSort(s));
  const sortable = (c: Column<T>) => c.sortable ?? !!c.sortValue;

  if (p.error && !p.rows.length) return <ErrorState error={p.error} onRetry={p.onRetry} compact />;

  return (
    <div className={cn("min-w-0", p.className)} data-testid={p.testId}>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full border-collapse text-left text-[14px]">
          <caption className="sr-only">{p.caption}</caption>
          <thead>
            <tr className="border-b border-border">
              {p.columns.map((c) => {
                const active = sort?.key === c.key;
                const aria = active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={aria}
                    className={cn("whitespace-nowrap py-2.5 pr-4 text-[12.5px] font-medium text-muted-foreground last:pr-0", c.align === "right" && "text-right", c.hideBelow && HIDE[c.hideBelow], c.className)}
                  >
                    {sortable(c) ? (
                      <button type="button" onClick={() => setSort(nextSort(sort, c.key))} className={cn("inline-flex items-center gap-1 rounded-sm hover:text-foreground", active && "text-foreground")}>
                        {c.header}
                        {active ? sort!.dir === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {p.loading && !p.rows.length
              ? Array.from({ length: p.skeletonRows ?? 6 }, (_, i) => (
                  <tr key={i} className="border-b border-border" aria-hidden>
                    {p.columns.map((c, j) => (
                      <td key={c.key} className={cn("py-3.5 pr-4 last:pr-0", c.hideBelow && HIDE[c.hideBelow])}>
                        <Skeleton className={cn("h-4", j === 0 ? "w-40" : "w-16", c.align === "right" && "ml-auto")} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const key = p.rowKey(row);
                  const clickable = !!p.onRowClick;
                  return (
                    <tr
                      key={key}
                      data-testid={p.rowTestId?.(row)}
                      aria-selected={p.selectedKey != null ? p.selectedKey === key : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? (e) => {
                        // Links and buttons inside a row keep their own behaviour.
                        if ((e.target as HTMLElement).closest("a,button,input,label,[role=menuitem]")) return;
                        p.onRowClick!(row);
                      } : undefined}
                      onKeyDown={clickable ? (e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          p.onRowClick!(row);
                        }
                      } : undefined}
                      className={cn(
                        "border-b border-border align-middle transition-colors",
                        clickable && "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                        p.selectedKey === key && "bg-primary/10",
                      )}
                    >
                      {p.columns.map((c) => (
                        <td key={c.key} className={cn("py-3 pr-4 last:pr-0", c.align === "right" && "text-right tabular-nums", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {!p.loading && !p.rows.length ? (
        <EmptyState compact icon={p.empty?.icon} title={p.empty?.title ?? "Nothing here yet"} description={p.empty?.description} action={p.empty?.action} />
      ) : null}
      {p.hasMore || p.loadingMore ? (
        <div className="flex justify-center py-4" aria-live="polite">
          {p.loadingMore ? (
            <Spinner />
          ) : (
            <Button variant="ghost" size="sm" onClick={p.onLoadMore} data-testid={p.testId ? `${p.testId}-more` : "table-load-more"}>
              Load more
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Spread a `usePagedList` result into DataTable props. */
export function pagedTable<T>(list: {
  items: T[];
  isPending: boolean;
  error: unknown;
  refetch: () => unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}): Pick<DataTableProps<T>, "rows" | "loading" | "error" | "onRetry" | "hasMore" | "loadingMore" | "onLoadMore"> {
  return {
    rows: list.items,
    loading: list.isPending,
    error: list.error,
    onRetry: () => void list.refetch(),
    hasMore: list.hasNextPage,
    loadingMore: list.isFetchingNextPage,
    onLoadMore: () => void list.fetchNextPage(),
  };
}
