"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check } from "lucide-react";
import type { CourseDetail } from "@open-lms/types";
import { Button, cn } from "@open-lms/ui";
import { api } from "@/lib/api";
import { accessCta, courseIncludes, learnHref, type AccessCta } from "@/lib/course-access";
import { formatDuration } from "@/lib/duration";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { CourseCover } from "./course-cover";
import { PriceTag } from "./price-tag";
import { ProgressLine } from "./progress-line";

/** Free enrollment: enroll, then straight into the classroom. */
export function useEnrollFree(slug: string) {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api().catalog.enrollFree(slug),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.courseAll });
      void qc.invalidateQueries({ queryKey: qk.myLearningAll });
      router.push(learnHref(slug, r.resumeItemId));
    },
  });
}

/** The one lit action for the course, from its access state. */
export function AccessButton({ course, cta, size = "lg", className }: { course: CourseDetail; cta: AccessCta; size?: "md" | "lg"; className?: string }) {
  const enroll = useEnrollFree(course.slug);
  const p = cta.primary;
  if (!p) return null;
  if (p.kind === "enroll") {
    return (
      <Button size={size} block className={className} loading={enroll.isPending} onClick={() => enroll.mutate()} data-testid={p.testId}>
        {p.label}
      </Button>
    );
  }
  return (
    <Button asChild size={size} block className={className} data-testid={p.testId}>
      <Link href={p.href}>{p.label}</Link>
    </Button>
  );
}

/** The sticky purchase card (lg and up): cover, price or progress, the action, what is included, bundles. */
export function PurchaseCard({ course, currency, onToggleSave }: { course: CourseDetail; currency?: string; onToggleSave?: () => void }) {
  const cta = accessCta(course, { currency });
  const includes = courseIncludes(course, formatDuration);
  const enrolled = course.access.state === "ENROLLED" ? course.access : null;
  return (
    <div className="overflow-hidden rounded-card bg-card shadow-card" data-testid="purchase-card">
      <CourseCover src={course.coverUrl} title={course.title} seed={course.slug} kicker={course.categories[0]?.name} />
      <div className="space-y-4 p-5">
        {enrolled ? (
          <ProgressLine percent={enrolled.progressPercent} showEmpty />
        ) : cta.price ? (
          <PriceTag price={cta.price} compareAt={cta.compareAt} size="lg" />
        ) : course.access.state === "FREE" || (course.access.state === "SIGNED_OUT" && course.access.free) ? (
          <p className="font-display text-[30px] font-semibold tracking-[-0.01em] text-success">Free</p>
        ) : null}
        <div className="space-y-2">
          <AccessButton course={course} cta={cta} />
          {cta.secondary ? (
            <p className="text-center text-[13.5px]">
              <Link href={cta.secondary.href} className="font-semibold text-link hover:underline" data-testid="cta-secondary">
                {cta.secondary.label}
              </Link>
            </p>
          ) : null}
        </div>
        {cta.note ? (
          <p className={cn("text-[13.5px]", course.access.state === "LAPSED" || course.access.state === "UNAVAILABLE" ? "text-foreground" : "text-muted-foreground")} data-testid="cta-note">
            {cta.note}
          </p>
        ) : null}
        {enrolled?.validUntil ? <p className="text-[13px] text-muted-foreground">Access until {new Date(enrolled.validUntil).toLocaleDateString(undefined, { dateStyle: "medium" })}.</p> : null}
        {onToggleSave && course.viewer && !cta.hasAccess ? (
          <Button variant="ghost" size="sm" onClick={onToggleSave} aria-pressed={course.viewer.saved} data-testid="course-save">
            <Bookmark fill={course.viewer.saved ? "currentColor" : "none"} />
            {course.viewer.saved ? "Saved" : "Save for later"}
          </Button>
        ) : null}

        {includes.length ? (
          <div className="border-t border-border pt-4">
            <h2 className="text-[13px] font-semibold text-foreground">This course includes</h2>
            <ul className="mt-2 space-y-1.5 text-[13.5px] text-muted-foreground">
              {includes.map((line) => (
                <li key={line} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {course.bundles.length && !cta.hasAccess ? (
          <div className="border-t border-border pt-4">
            <h2 className="text-[13px] font-semibold text-foreground">Also in {course.bundles.length === 1 ? "a bundle" : "bundles"}</h2>
            <ul className="mt-1 divide-y divide-border">
              {course.bundles.map((b) => (
                <li key={b.id}>
                  <Link href={`/bundles/${encodeURIComponent(b.slug)}`} className="flex items-baseline justify-between gap-3 py-2 text-[13.5px] hover:text-primary" data-testid="course-bundle">
                    <span className="min-w-0 truncate font-medium">{b.title}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {b.courseCount} courses{b.price ? ` · ${formatMoney(b.price, { compact: true })}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Phones and tablets: the price and the action pinned above the bottom nav. */
export function PurchaseBar({ course, currency }: { course: CourseDetail; currency?: string }) {
  const cta = accessCta(course, { currency });
  const enrolled = course.access.state === "ENROLLED" ? course.access : null;
  if (!cta.primary && !cta.note) return null;
  return (
    <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur-md md:bottom-0 lg:hidden" data-testid="purchase-bar">
      <div className="mx-auto flex max-w-[720px] items-center gap-4">
        <div className="min-w-0 flex-1">
          {enrolled ? (
            <p className="text-[13.5px] font-semibold">{enrolled.progressPercent}% complete</p>
          ) : cta.price ? (
            <PriceTag price={cta.price} compareAt={cta.compareAt} size="md" />
          ) : (
            <p className="line-clamp-2 text-[13px] text-muted-foreground">{cta.note ?? course.title}</p>
          )}
        </div>
        {cta.primary ? <AccessButton course={course} cta={{ ...cta, primary: { ...cta.primary, label: shortLabel(cta.primary.label), testId: `${cta.primary.testId}-bar` } }} size="md" className="w-auto shrink-0" /> : null}
      </div>
    </div>
  );
}

/** "Buy now · $49" reads as "Buy now" next to the price already on the bar. */
function shortLabel(label: string): string {
  return label.replace(/ · .*$/, "").replace(" (staff preview)", "");
}
