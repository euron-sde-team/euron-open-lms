import type { ReactNode } from "react";
import { cn } from "@open-lms/ui";

/** The standard page column: content width with the site gutters. */
export function Page({ children, className, width = "content" }: { children: ReactNode; className?: string; width?: "content" | "reading" | "wide" }) {
  const max = width === "reading" ? "max-w-[760px]" : width === "wide" ? "max-w-[1400px]" : "max-w-[1200px]";
  return <main id="main" className={cn("mx-auto w-full px-4 pb-16 pt-8 sm:px-6", max, className)}>{children}</main>;
}

/** A page heading: display title, optional lead and actions on the right. */
export function PageHeader({ title, lead, actions, kicker, className }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; kicker?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4 pb-6", className)}>
      <div className="min-w-0">
        {kicker ? <p className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-primary">{kicker}</p> : null}
        <h1 className="text-balance font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[40px]">{title}</h1>
        {lead ? <div className="mt-3 max-w-2xl text-[15.5px] text-muted-foreground">{lead}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Full-bleed pages (landing, classroom). */
export function FullWidth({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id="main" className={cn("min-w-0", className)}>
      {children}
    </main>
  );
}
