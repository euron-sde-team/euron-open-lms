"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@open-lms/ui";
import { UnderlineTabs, type UnderlineTab } from "@/components/common/underline-tabs";

export interface FilterBarProps<V extends string> {
  tabs?: UnderlineTab<V>[];
  tab?: V;
  onTabChange?: (v: V) => void;
  tabsLabel?: string;
  /** The search term (controlled). `onSearchChange` fires debounced by `debounceMs`. */
  search?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  debounceMs?: number;
  /** Extra controls on the right (a select, a date range). */
  children?: ReactNode;
  className?: string;
  testId?: string;
}

/** Underline tabs on the left, one search field (and optional controls) on the right. */
export function FilterBar<V extends string>({
  tabs, tab, onTabChange, tabsLabel = "Filter", search, onSearchChange, searchPlaceholder = "Search", debounceMs = 300, children, className, testId = "filter-bar",
}: FilterBarProps<V>) {
  return (
    <div className={cn("flex flex-col gap-3 border-b border-border md:flex-row md:items-end md:justify-between", className)} data-testid={testId}>
      {tabs && tab !== undefined ? (
        <UnderlineTabs tabs={tabs} value={tab} onChange={onTabChange} label={tabsLabel} className="min-w-0 border-b-0" />
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center gap-2 pb-2.5">
        {children}
        {onSearchChange ? <SearchInput value={search ?? ""} onChange={onSearchChange} placeholder={searchPlaceholder} debounceMs={debounceMs} testId={`${testId}-search`} /> : null}
      </div>
    </div>
  );
}

/** A search field that keeps its own text and reports it debounced. */
export function SearchInput({ value, onChange, placeholder, debounceMs = 300, testId, className }: { value: string; onChange: (v: string) => void; placeholder: string; debounceMs?: number; testId?: string; className?: string }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    // An outside change (back button, a cleared filter) wins over the local text.
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text === last.current) return;
    const t = setTimeout(() => {
      last.current = text;
      onChange(text);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [text, debounceMs, onChange]);
  return (
    <div className={cn("relative w-full sm:w-64", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid={testId}
        className="h-9 w-full rounded-[10px] bg-ground-2 pl-9 pr-8 text-sm text-foreground placeholder:text-subtle-foreground focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {text ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            last.current = "";
            setText("");
            onChange("");
          }}
          className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-subtle-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
