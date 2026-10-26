"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Eye } from "lucide-react";
import type { CourseDetail, CurriculumItemPublic } from "@open-lms/types";
import { Skeleton, SkeletonText } from "@open-lms/ui";
import { ErrorState, NotFoundState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { UserAvatar, instructorHref, userTagline } from "@/components/common/user-bits";
import { FullWidth } from "@/components/shell/layouts";
import { isApiError } from "@open-lms/api-client";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { catalogHref } from "@/lib/catalog-filters";
import { useDisplayCurrency } from "@/lib/currency";
import { formatDuration, languageName, levelLabel } from "@/lib/duration";
import { useSaveCourse } from "@/lib/hooks/use-save-course";
import { qk } from "@/lib/query-keys";
import { CourseReviews } from "./course-reviews";
import { Curriculum } from "./curriculum";
import { PreviewDialog } from "./preview-dialog";
import { PurchaseBar, PurchaseCard } from "./purchase-card";
import { RatingLine } from "./stars";

const SECTIONS = [
  { value: "overview", label: "Overview" },
  { value: "curriculum", label: "Curriculum" },
  { value: "instructors", label: "Instructors" },
  { value: "reviews", label: "Reviews" },
] as const;
type SectionId = (typeof SECTIONS)[number]["value"];

/** Highlights the section nearest the top of the viewport (below the sticky strip). */
function useScrollSpy(ids: readonly string[], enabled: boolean): [string, (id: string) => void] {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const visible = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = ids.find((id) => visible.get(id));
        if (first) setActive(first);
      },
      { rootMargin: "-140px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids, enabled]);
  const go = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  return [active, go];
}

export function CoursePage({ slug }: { slug: string }) {
  const { status } = useAuth();
  const { currency, ready } = useDisplayCurrency();
  const q = useQuery({
    queryKey: qk.course(slug, currency),
    queryFn: () => api().catalog.course(slug, currency),
    enabled: ready && status !== "loading",
  });
  const [preview, setPreview] = useState<CurriculumItemPublic | null>(null);
  const { toggle } = useSaveCourse();
  const ids = SECTIONS.map((s) => s.value);
  const [active, go] = useScrollSpy(ids, !!q.data);

  if (q.isError) {
    return (
      <main id="main" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        {isApiError(q.error) && q.error.status === 404 ? <NotFoundState title="This course is not available" description="It may have been unpublished, or the link may be wrong." /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      </main>
    );
  }
  if (!q.data) return <CoursePageSkeleton />;
  const c = q.data;
  const onSave = c.viewer ? () => toggle(c) : undefined;

  return (
    <FullWidth className="pb-28 lg:pb-16">
      <div className="relative">
        {c.access.state === "STAFF" ? <StaffBanner course={c} /> : null}
        <Hero course={c} />

        <div className="sticky top-header z-30 border-b border-border bg-background/90 backdrop-blur-md">
          <div className="mx-auto max-w-[1200px] px-4 pt-3 sm:px-6">
            <div className="lg:pr-[400px]">
              <UnderlineTabs<SectionId> label="Course sections" tabs={[...SECTIONS]} value={active as SectionId} onChange={go} className="border-b-0" />
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <div className="space-y-14 pt-10 lg:pr-[400px]">
            <section id="overview" className="scroll-mt-[calc(var(--header-height)+64px)]" aria-labelledby="overview-title">
              <h2 id="overview-title" className="sr-only">
                Overview
              </h2>
              {c.outcomes.length ? (
                <div className="mb-10">
                  <h3 className="font-display text-[22px] font-semibold tracking-[-0.01em]">What you will learn</h3>
                  <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2" data-testid="course-outcomes">
                    {c.outcomes.map((o) => (
                      <li key={o} className="flex gap-2.5 text-[14.5px] leading-relaxed">
                        <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
                        {o}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {c.descriptionHtml ? (
                <div>
                  <h3 className="font-display text-[22px] font-semibold tracking-[-0.01em]">About this course</h3>
                  {/* Sanitized on the server (renderAuthored). */}
                  <div className="lms-prose mt-4" dangerouslySetInnerHTML={{ __html: c.descriptionHtml }} />
                </div>
              ) : null}
              {c.prerequisites.length ? (
                <div className="mt-10">
                  <h3 className="font-display text-[22px] font-semibold tracking-[-0.01em]">Before you start</h3>
                  <ul className="mt-3 divide-y divide-border border-y border-border">
                    {c.prerequisites.map((p) => (
                      <li key={p} className="py-3 text-[14.5px]">
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section id="curriculum" className="scroll-mt-[calc(var(--header-height)+64px)]" aria-labelledby="curriculum-title">
              <h2 id="curriculum-title" className="mb-4 font-display text-[26px] font-semibold tracking-[-0.02em]">
                Curriculum
              </h2>
              <Curriculum sections={c.sections} onPreview={setPreview} />
            </section>

            <section id="instructors" className="scroll-mt-[calc(var(--header-height)+64px)]" aria-labelledby="instructors-title">
              <h2 id="instructors-title" className="mb-4 font-display text-[26px] font-semibold tracking-[-0.02em]">
                {c.instructors.length === 1 ? "Your instructor" : "Your instructors"}
              </h2>
              <ul className="divide-y divide-border border-t border-border">
                {c.instructors.map((i) => (
                  <li key={i.id} className="flex gap-4 py-6" data-testid="course-instructor">
                    <UserAvatar user={i} size="lg" href={instructorHref(i.username)} />
                    <div className="min-w-0">
                      <Link href={instructorHref(i.username)} className="font-display text-[18px] font-semibold hover:text-primary">
                        {i.displayName}
                      </Link>
                      <p className="text-[13.5px] text-muted-foreground">{userTagline(i)}</p>
                      {i.bio ? <p className="mt-2 line-clamp-5 whitespace-pre-line text-[14.5px] leading-relaxed">{i.bio}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section id="reviews" className="scroll-mt-[calc(var(--header-height)+64px)]" aria-labelledby="reviews-title">
              <h2 id="reviews-title" className="mb-6 font-display text-[26px] font-semibold tracking-[-0.02em]">
                Reviews
              </h2>
              <CourseReviews course={c} />
            </section>
          </div>
        </div>

        {/* The sticky purchase card rides in the right column from lg. */}
        <div className="pointer-events-none absolute inset-0 z-40 hidden lg:block">
          <div className="relative mx-auto h-full max-w-[1200px] px-6">
            <aside className="pointer-events-auto absolute bottom-0 right-6 top-10 w-[360px]" aria-label="Get this course">
              <div className="sticky top-[calc(var(--header-height)+20px)]">
                <PurchaseCard course={c} currency={currency} onToggleSave={onSave} />
              </div>
            </aside>
          </div>
        </div>
      </div>

      <PurchaseBar course={c} currency={currency} />
      <PreviewDialog item={preview} courseTitle={c.title} onOpenChange={(o) => !o && setPreview(null)} />
    </FullWidth>
  );
}

function Hero({ course: c }: { course: CourseDetail }) {
  const cat = c.categories[0];
  const meta = [levelLabel(c.level), c.durationSeconds ? formatDuration(c.durationSeconds) : null, `${c.itemCount} ${c.itemCount === 1 ? "lesson" : "lessons"}`, languageName(c.language)].filter(Boolean).join(" · ");
  return (
    <section className="border-b border-border bg-ground-2">
      <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-8 sm:px-6 lg:pb-14 lg:pt-10">
        <div className="animate-rise lg:pr-[400px]">
          <nav aria-label="Breadcrumb" className="mb-5 text-[13px] text-muted-foreground">
            <ol className="flex flex-wrap items-center gap-1">
              <li>
                <Link href="/courses" className="hover:text-foreground">
                  Courses
                </Link>
              </li>
              {cat ? (
                <>
                  <ChevronRight className="size-3.5" aria-hidden />
                  <li>
                    <Link href={catalogHref({ category: cat.slug })} className="font-semibold text-primary hover:underline">
                      {cat.name}
                    </Link>
                  </li>
                </>
              ) : null}
            </ol>
          </nav>
          <h1 className="text-balance font-display text-[34px] font-semibold leading-[1.06] tracking-[-0.025em] sm:text-[46px]" data-testid="course-title">
            {c.title}
          </h1>
          {c.subtitle ? <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted-foreground">{c.subtitle}</p> : null}
          <p className="mt-5 text-[13.5px] text-muted-foreground">{meta}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            {c.instructors.length ? (
              <p className="flex items-center gap-2 text-[14px]">
                <span className="flex -space-x-2">
                  {c.instructors.slice(0, 3).map((i) => (
                    <UserAvatar key={i.id} user={i} size="xs" className="ring-2 ring-ground-2" />
                  ))}
                </span>
                <span className="text-muted-foreground">
                  By{" "}
                  {c.instructors.map((i, n) => (
                    <span key={i.id}>
                      {n > 0 ? ", " : null}
                      <Link href={instructorHref(i.username)} className="font-semibold text-foreground hover:text-primary">
                        {i.displayName}
                      </Link>
                    </span>
                  ))}
                </span>
              </p>
            ) : null}
            <RatingLine rating={c.rating} />
            {c.enrollmentCount > 0 ? <span className="text-[13.5px] text-muted-foreground tabular-nums">{c.enrollmentCount.toLocaleString()} learners</span> : null}
          </div>
          <p className="mt-3 text-[12.5px] text-subtle-foreground">Updated {new Date(c.updatedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
        </div>
      </div>
    </section>
  );
}

function StaffBanner({ course }: { course: CourseDetail }) {
  const draft = course.status !== "PUBLISHED";
  return (
    <div className="border-b border-border bg-warning-soft text-warning-soft-foreground" role="status" data-testid="staff-banner">
      <div className="mx-auto flex max-w-[1200px] items-center gap-2 px-4 py-2.5 text-[13.5px] sm:px-6">
        <Eye className="size-4 shrink-0" aria-hidden />
        {draft ? `Staff preview. This course is ${course.status === "ARCHIVED" ? "archived" : "not published"}, so only its team and admins can see this page.` : "You are on this course's team. Learners see the price and enroll button here."}
      </div>
    </div>
  );
}

function CoursePageSkeleton() {
  return (
    <main id="main" aria-busy className="min-w-0">
      <div className="border-b border-border bg-ground-2">
        <div className="mx-auto max-w-[1200px] space-y-4 px-4 pb-14 pt-10 sm:px-6 lg:pr-[424px]">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="mx-auto max-w-[1200px] px-4 pt-10 sm:px-6 lg:pr-[424px]">
        <SkeletonText lines={6} />
      </div>
    </main>
  );
}
