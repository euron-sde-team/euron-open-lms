"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@open-lms/ui";

export interface AdminPageProps {
  title: ReactNode;
  description?: ReactNode;
  /** The one primary action (and quieter secondary ones) on the right of the title. */
  actions?: ReactNode;
  /** A FilterBar (or any filter row) under the header. */
  filters?: ReactNode;
  /** A link back to the parent list, shown above the title. */
  back?: { href: string; label: string };
  children: ReactNode;
  className?: string;
  testId?: string;
}

/** Every admin page: header (title, description, primary action), filters, content. */
export function AdminPage({ title, description, actions, filters, back, children, className, testId }: AdminPageProps) {
  return (
    <div className={cn("mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 sm:px-6 lg:pt-8", className)} data-testid={testId}>
      {back ? (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden /> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
        <div className="min-w-0">
          <h1 className="text-balance font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[30px]">{title}</h1>
          {description ? <p className="mt-1.5 max-w-2xl text-[14.5px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {filters ? <div className="mb-4">{filters}</div> : null}
      {children}
    </div>
  );
}

/** A titled block inside an admin page (no card: a heading and a hairline above). */
export function AdminSection({ title, description, actions, children, className, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("border-t border-border pt-6 [&+&]:mt-10", className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="font-display text-[19px] font-semibold tracking-[-0.015em]">{title}</h2>
          {description ? <p className="mt-1 max-w-2xl text-[13.5px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
