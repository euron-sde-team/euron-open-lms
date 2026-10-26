"use client";

import Link from "next/link";
import { cn } from "@open-lms/ui";

export interface UnderlineTab<V extends string> {
  value: V;
  label: string;
  /** Render as a link (keeps the choice in the URL) instead of a button. */
  href?: string;
  count?: number | null;
}

/**
 * Tabs and filters as plain words (DESIGN.md rule 3): the active one in ink with a 2px
 * underline as wide as the word, the rest quiet. Scrolls sideways on narrow screens.
 */
export function UnderlineTabs<V extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
  size = "md",
}: {
  tabs: UnderlineTab<V>[];
  value: V;
  onChange?: (v: V) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("no-scrollbar flex items-center gap-6 overflow-x-auto border-b border-border", className)}>
      {tabs.map((t) => {
        const active = t.value === value;
        const inner = (
          <>
            {t.label}
            {t.count != null ? <span className={cn("ml-1.5 tabular-nums", active ? "text-muted-foreground" : "text-subtle-foreground")}>{t.count}</span> : null}
            <span aria-hidden className={cn("absolute inset-x-0 -bottom-px h-0.5 rounded-full transition-colors", active ? "bg-ink" : "bg-transparent")} />
          </>
        );
        const cls = cn(
          "relative shrink-0 whitespace-nowrap pb-3 pt-1 font-medium transition-colors focus-visible:rounded-sm",
          size === "sm" ? "text-[13px]" : "text-[14.5px]",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        );
        return t.href ? (
          <Link key={t.value} href={t.href} role="tab" aria-selected={active} className={cls} scroll={false}>
            {inner}
          </Link>
        ) : (
          <button key={t.value} type="button" role="tab" aria-selected={active} className={cls} onClick={() => onChange?.(t.value)}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}
