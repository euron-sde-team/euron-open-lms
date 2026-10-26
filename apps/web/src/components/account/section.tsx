import type { ReactNode } from "react";
import { cn } from "@open-lms/ui";

/**
 * One settings section (DESIGN.md rule 2: forms are not wrapped in cards): a heading, one
 * line of help, the fields, then the actions. Sections stack, separated by hairlines.
 */
export function AccountSection({
  title,
  description,
  children,
  actions,
  className,
  testId,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={cn("border-b border-border py-8 first:pt-0 last:border-b-0", className)} data-testid={testId}>
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em]">{title}</h2>
      {description ? <p className="mt-1 max-w-[620px] text-[14px] text-muted-foreground">{description}</p> : null}
      {children ? <div className="mt-5">{children}</div> : null}
      {actions ? <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </section>
  );
}

/** A heading for the section a page shows (the section list already names it on desktop). */
export function SectionTitle({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">{title}</h1>
      {lead ? <p className="mt-1.5 max-w-[620px] text-[14.5px] text-muted-foreground">{lead}</p> : null}
    </div>
  );
}
