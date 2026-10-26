"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Skeleton, cn } from "@open-lms/ui";

export interface StatItem {
  label: string;
  value: ReactNode;
  /** A quiet second line ("12 new"). */
  hint?: ReactNode;
  href?: string;
  testId?: string;
}

/** Numbers as type: big display figures with a label, in a row that wraps. No tiles, no borders. */
export function StatLine({ items, loading, size = "md", className, testId = "stat-line" }: { items: StatItem[]; loading?: boolean; size?: "md" | "lg"; className?: string; testId?: string }) {
  return (
    <dl className={cn("flex flex-wrap gap-x-10 gap-y-5", className)} data-testid={testId}>
      {items.map((i) => {
        const value = (
          <dd className={cn("font-display font-semibold tabular-nums tracking-[-0.02em] text-foreground", size === "lg" ? "text-[34px] leading-none" : "text-[26px] leading-none")}>
            {loading ? <Skeleton className="h-7 w-20" /> : i.value}
          </dd>
        );
        return (
          <div key={i.label} className="flex min-w-0 flex-col-reverse gap-1.5" data-testid={i.testId}>
            <dt className="text-[13px] text-muted-foreground">
              {i.href ? (
                <Link href={i.href} className="hover:text-foreground hover:underline">
                  {i.label}
                </Link>
              ) : (
                i.label
              )}
              {i.hint && !loading ? <span className="text-subtle-foreground"> · {i.hint}</span> : null}
            </dt>
            {value}
          </div>
        );
      })}
    </dl>
  );
}
