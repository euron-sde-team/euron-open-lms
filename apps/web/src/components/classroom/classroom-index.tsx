"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Spinner } from "@open-lms/ui";
import { courseHref } from "@/components/course/course-card";
import { CourseCover } from "@/components/course/course-cover";
import { ProgressLine } from "@/components/course/progress-line";
import { firstItemId, flattenItems, startItemId } from "@/lib/classroom/curriculum";
import { formatDuration } from "@/lib/duration";
import { learnHref, useClassroom } from "./classroom-context";

/** /learn/:slug: straight to the resume item, or a short course overview when there is none. */
export function ClassroomIndex() {
  const { slug, classroom } = useClassroom();
  const router = useRouter();
  const resume = startItemId(classroom);
  useEffect(() => {
    if (resume) router.replace(learnHref(slug, resume));
  }, [resume, router, slug]);

  if (resume) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <Spinner size="lg" />
        <span className="sr-only">Opening where you left off</span>
      </div>
    );
  }

  const first = firstItemId(classroom);
  const items = flattenItems(classroom.sections);
  const total = items.reduce((n, f) => n + f.item.durationSeconds, 0);
  const e = classroom.enrollment;
  return (
    <div className="mx-auto max-w-[720px] animate-rise px-4 py-10 sm:px-6" data-testid="classroom-overview">
      <CourseCover src={classroom.course.coverUrl} title={classroom.course.title} seed={classroom.course.slug} rounded="all" className="aspect-video w-full" />
      <h1 className="mt-6 text-balance font-display text-[30px] font-semibold leading-tight tracking-[-0.02em]">{classroom.course.title}</h1>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {classroom.sections.length} {classroom.sections.length === 1 ? "section" : "sections"} · {items.length} {items.length === 1 ? "lesson" : "lessons"}
        {total > 0 ? ` · ${formatDuration(total)}` : ""}
      </p>
      {e ? <ProgressLine percent={e.progressPercent} completed={e.completedItems} total={e.totalItems} showEmpty className="mt-5" /> : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {first ? (
          <Button asChild size="lg" data-testid="classroom-start">
            <Link href={learnHref(slug, first)}>{e && e.completedItems > 0 ? "Continue" : "Start the course"}</Link>
          </Button>
        ) : (
          <p className="text-[14.5px] text-muted-foreground">This course has no lessons yet.</p>
        )}
        <Button asChild variant="link">
          <Link href={courseHref(slug)}>About this course</Link>
        </Button>
      </div>
    </div>
  );
}
