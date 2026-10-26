"use client";

import type { ReactNode } from "react";
import { DialogDescription, DialogTitle, Sheet, SheetContent, Skeleton, cn } from "@open-lms/ui";
import { ErrorState } from "@/components/common/states";

export interface DetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Shown left of the title (an avatar, a cover). */
  leading?: ReactNode;
  /** Actions under the title (outline / ghost buttons, a menu). */
  actions?: ReactNode;
  /** Pinned to the bottom (a save bar). */
  footer?: ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  children?: ReactNode;
  /** Tailwind max-width class; default max-w-xl. */
  width?: string;
  testId?: string;
}

/** The right-side detail panel for a row: header, then DetailSections separated by hairlines. */
export function DetailSheet(p: DetailSheetProps) {
  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent side="right" width={p.width ?? "max-w-xl"} data-testid={p.testId ?? "detail-sheet"} aria-describedby={undefined}>
        <div className="shrink-0 border-b border-border px-5 pb-4 pt-5 pr-12">
          <div className="flex items-start gap-3">
            {p.leading}
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate font-display text-[20px] font-semibold tracking-[-0.015em]">{p.loading && !p.title ? <Skeleton className="h-6 w-48" /> : p.title}</DialogTitle>
              {p.description ? <DialogDescription asChild><div className="mt-0.5 text-[13px] text-muted-foreground">{p.description}</div></DialogDescription> : null}
            </div>
          </div>
          {p.actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{p.actions}</div> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {p.error ? (
            <ErrorState error={p.error} onRetry={p.onRetry} compact />
          ) : p.loading ? (
            <div className="space-y-6 py-5" aria-busy>
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          ) : (
            p.children
          )}
        </div>
        {p.footer ? <div className="shrink-0 border-t border-border px-5 py-3">{p.footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}

/** One section of a DetailSheet: a small heading, optional action, content; hairline between sections. */
export function DetailSection({ title, action, children, className, testId }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("border-b border-border py-5 last:border-b-0", className)} data-testid={testId}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label and value pairs as type (a definition list), for profile facts. */
export function FactList({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13.5px]", className)}>
      {items.map((i) => (
        <div key={i.label} className="contents">
          <dt className="text-muted-foreground">{i.label}</dt>
          <dd className="min-w-0 break-words text-foreground">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
