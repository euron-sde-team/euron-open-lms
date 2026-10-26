"use client";

import Link from "next/link";
import { Bookmark } from "lucide-react";
import type { CourseCard as Course } from "@open-lms/types";
import { cn } from "@open-lms/ui";
import { formatDuration, levelLabel } from "@/lib/duration";
import { CourseCover } from "./course-cover";
import { PriceTag } from "./price-tag";
import { ProgressLine } from "./progress-line";
import { RatingLine } from "./stars";

export const courseHref = (slug: string) => `/courses/${encodeURIComponent(slug)}`;

/** What the bottom line of a card says when there is no price to show. */
function accessLabel(c: Course): string | null {
  if (c.viewer?.enrolled) return null;
  if (c.accessMode === "FREE") return "Free";
  if (c.accessMode === "SUBSCRIPTION_ONLY") return "Included in plans";
  return c.price ? null : "Not on sale in your currency";
}

/**
 * The course card used in every grid and rail. The cover is the only surface; the rest
 * is type: title, instructors, one meta line, the rating, and the price or access state
 * pinned to the bottom (DESIGN.md: course card).
 */
export function CourseCard({ course, onToggleSave, className, priority }: { course: Course; onToggleSave?: (c: Course) => void; className?: string; priority?: boolean }) {
  const label = accessLabel(course);
  const instructors = course.instructors.map((i) => i.displayName).join(", ");
  return (
    <article className={cn("group relative flex flex-col overflow-hidden rounded-card bg-card shadow-card transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-card-hover", className)} data-testid="course-card" data-priority={priority ? "" : undefined}>
      <Link href={courseHref(course.slug)} className="absolute inset-0 z-10 rounded-card focus-visible:ring-2 focus-visible:ring-ring" aria-label={course.title} />
      <CourseCover src={course.coverUrl} title={course.title} seed={course.slug} kicker={course.categories[0]?.name} />
      {onToggleSave && !course.viewer?.enrolled ? (
        <button
          type="button"
          onClick={() => onToggleSave(course)}
          aria-pressed={!!course.viewer?.saved}
          aria-label={course.viewer?.saved ? "Remove from saved" : "Save for later"}
          data-testid="course-save-toggle"
          className="absolute right-3 top-3 z-20 grid size-9 place-items-center rounded-full bg-background/70 text-foreground backdrop-blur-md transition-colors hover:bg-background/90"
        >
          <Bookmark className="size-4" fill={course.viewer?.saved ? "currentColor" : "none"} />
        </button>
      ) : null}
      <div className="flex flex-1 flex-col gap-1.5 p-4 pt-3.5">
        <h3 className="line-clamp-2 font-display text-[17px] font-semibold leading-snug tracking-[-0.01em] text-foreground">{course.title}</h3>
        {instructors ? <p className="truncate text-[13px] text-muted-foreground">{instructors}</p> : null}
        <p className="text-[12.5px] text-subtle-foreground">
          {[levelLabel(course.level), course.durationSeconds ? formatDuration(course.durationSeconds) : null, `${course.itemCount} lessons`].filter(Boolean).join(" · ")}
        </p>
        <RatingLine rating={course.rating} />
        <div className="mt-auto pt-2">
          {course.viewer?.enrolled ? (
            <ProgressLine percent={course.viewer.progressPercent ?? 0} showEmpty />
          ) : label ? (
            <p className={cn("text-[14px] font-semibold", course.accessMode === "FREE" ? "text-success" : "text-foreground")}>{label}</p>
          ) : (
            <PriceTag price={course.price} compareAt={course.compareAt} size="sm" />
          )}
        </div>
      </div>
    </article>
  );
}

/** A matching skeleton, so grids keep their shape while loading. */
export function CourseCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card bg-card shadow-card" aria-hidden>
      <div className="aspect-video w-full animate-shimmer bg-muted" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-4/5 animate-shimmer rounded bg-muted" />
        <div className="h-3 w-1/2 animate-shimmer rounded bg-muted" />
        <div className="h-3 w-2/3 animate-shimmer rounded bg-muted" />
        <div className="h-4 w-1/4 animate-shimmer rounded bg-muted pt-2" />
      </div>
    </div>
  );
}

/** The responsive grid every course list uses. */
export function CourseGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)}>{children}</div>;
}
