"use client";

import { useQuery } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { Skeleton, SkeletonText } from "@open-lms/ui";
import { CourseCard, CourseCardSkeleton, CourseGrid } from "@/components/course/course-card";
import { ErrorState } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-bits";
import { Page } from "@/components/shell/layouts";
import { api } from "@/lib/api";
import { useSaveCourse } from "@/lib/hooks/use-save-course";
import { qk } from "@/lib/query-keys";
import { safeHref } from "@/lib/text";

/** /instructors/[username]: who they are, then their published courses. */
export function InstructorPage({ username }: { username: string }) {
  const q = useQuery({ queryKey: qk.instructor(username), queryFn: () => api().catalog.instructor(username) });
  const { toggle } = useSaveCourse();

  if (q.isError) {
    return (
      <Page>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  }
  if (!q.data) {
    return (
      <Page width="content">
        <div className="flex items-center gap-5">
          <Skeleton className="size-20 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <SkeletonText lines={3} className="mt-8 max-w-[720px]" />
        <CourseGrid className="mt-12">
          {Array.from({ length: 3 }, (_, i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </CourseGrid>
      </Page>
    );
  }
  const { instructor: i, courses } = q.data;
  const site = i.website ? safeHref(i.website) : null;
  return (
    <Page>
      <header className="flex flex-col gap-5 border-b border-border pb-10 sm:flex-row sm:items-center">
        <UserAvatar user={i} size="xl" />
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-primary">Instructor</p>
          <h1 className="mt-1 font-display text-[34px] font-semibold leading-tight tracking-[-0.02em] sm:text-[42px]" data-testid="instructor-name">
            {i.displayName}
          </h1>
          {i.headline ? <p className="mt-1 text-[16px] text-muted-foreground">{i.headline}</p> : null}
          {site ? (
            <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-flex items-center gap-1.5 text-[14px] font-medium text-link hover:underline">
              <Globe className="size-4" aria-hidden />
              {site.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          ) : null}
        </div>
      </header>
      {i.bio ? <p className="mt-8 max-w-[720px] whitespace-pre-line text-[15.5px] leading-relaxed">{i.bio}</p> : null}
      <h2 className="mb-6 mt-12 font-display text-[24px] font-semibold tracking-[-0.02em]">
        Courses{courses.length ? <span className="ml-2 font-sans text-[15px] font-medium tabular-nums text-subtle-foreground">{courses.length}</span> : null}
      </h2>
      {courses.length ? (
        <CourseGrid>
          {courses.map((c) => (
            <CourseCard key={c.id} course={c} onToggleSave={toggle} />
          ))}
        </CourseGrid>
      ) : (
        <p className="text-[14.5px] text-muted-foreground">No published courses yet.</p>
      )}
    </Page>
  );
}
