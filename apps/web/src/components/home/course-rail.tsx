"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { CourseCard as Course } from "@open-lms/types";
import { cn } from "@open-lms/ui";
import { CourseCard, CourseCardSkeleton } from "@/components/course/course-card";

/**
 * A titled row of course cards: a sideways-scrolling strip on phones (cards snap), a
 * grid from `md`. Renders nothing when a loaded rail is empty.
 */
export function CourseRail({
  title,
  lead,
  courses,
  loading,
  href,
  hrefLabel = "See all",
  onToggleSave,
  testId,
  className,
}: {
  title: string;
  lead?: string;
  courses: Course[] | undefined;
  loading?: boolean;
  href?: string;
  hrefLabel?: string;
  onToggleSave?: (c: Course) => void;
  testId?: string;
  className?: string;
}) {
  if (!loading && (!courses || courses.length === 0)) return null;
  const items = (courses ?? []).slice(0, 8);
  return (
    <section className={cn("animate-rise", className)} aria-labelledby={testId ? `${testId}-title` : undefined} data-testid={testId}>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id={testId ? `${testId}-title` : undefined} className="font-display text-[24px] font-semibold tracking-[-0.02em] sm:text-[28px]">
            {title}
          </h2>
          {lead ? <p className="mt-1 text-[14px] text-muted-foreground">{lead}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[14px] font-semibold text-link hover:underline">
            {hrefLabel} <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
      <RailTrack>
        {loading && !courses
          ? Array.from({ length: 4 }, (_, i) => (
              <RailCell key={i} index={i}>
                <CourseCardSkeleton />
              </RailCell>
            ))
          : items.map((c, i) => (
              <RailCell key={c.id} index={i}>
                <CourseCard course={c} onToggleSave={onToggleSave} className="h-full" />
              </RailCell>
            ))}
      </RailTrack>
    </section>
  );
}

/** The scrolling strip on phones, a 2/3/4 column grid from md. */
export function RailTrack({ children }: { children: React.ReactNode }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:snap-none md:grid-cols-2 md:gap-6 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3 xl:grid-cols-4">{children}</div>
  );
}

/**
 * One cell: 78% of the screen on phones so the next card peeks in. Phones scroll through
 * up to eight; the grid keeps one full row (four at md and xl, three at lg).
 */
export function RailCell({ children, index = 0 }: { children: React.ReactNode; index?: number }) {
  return <div className={cn("w-[78%] shrink-0 snap-start sm:w-[46%] md:w-auto", index >= 4 && "md:hidden", index === 3 && "lg:hidden xl:block")}>{children}</div>;
}
