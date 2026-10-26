"use client";

import type { CourseDetail, Review } from "@open-lms/types";
import { Button, Skeleton, Spinner, cn } from "@open-lms/ui";
import { useState } from "react";
import { ReportDialog } from "@/components/classroom/qa-panel";
import { TimeAgo } from "@/components/common/time-ago";
import { StaffMark, UserAvatar } from "@/components/common/user-bits";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { Stars } from "./stars";

/** Share of each star rating, 0..100, from the breakdown counts. */
export function breakdownPercents(b: CourseDetail["ratingBreakdown"]): { stars: 5 | 4 | 3 | 2 | 1; count: number; percent: number }[] {
  const total = Object.values(b).reduce((a, n) => a + n, 0);
  return ([5, 4, 3, 2, 1] as const).map((s) => ({ stars: s, count: b[String(s) as keyof typeof b], percent: total ? Math.round((b[String(s) as keyof typeof b] * 100) / total) : 0 }));
}

/** Reviews: the average, a breakdown in bars, then the reviews with instructor replies. */
export function CourseReviews({ course }: { course: CourseDetail }) {
  const list = usePagedList<Review>({
    queryKey: qk.courseReviews(course.slug),
    fetchPage: (cursor) => api().catalog.reviews(course.slug, { cursor, limit: 10 }),
  });
  const rating = course.rating;

  if (!rating || rating.count === 0) {
    return <p className="text-[14.5px] text-muted-foreground">No reviews yet. Learners can review the course once they have made some progress.</p>;
  }

  return (
    <div className="grid gap-10 md:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <p className="font-display text-[48px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{rating.average.toFixed(1)}</p>
        <Stars value={rating.average} size={16} className="mt-2" />
        <p className="mt-1 text-[13px] text-muted-foreground">
          {rating.count.toLocaleString()} {rating.count === 1 ? "rating" : "ratings"}
        </p>
        <ul className="mt-5 space-y-1.5" aria-label="Rating breakdown">
          {breakdownPercents(course.ratingBreakdown).map((r) => (
            <li key={r.stars} className="flex items-center gap-2 text-[12.5px] text-muted-foreground" aria-label={`${r.stars} stars: ${r.percent}%`}>
              <span className="w-10 tabular-nums">{r.stars} star</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground-2" aria-hidden>
                <span className="block h-full rounded-full bg-star" style={{ width: `${r.percent}%` }} />
              </span>
              <span className="w-9 text-right tabular-nums">{r.percent}%</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {list.isPending ? (
          <div className="space-y-6">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="space-y-2 border-b border-border pb-6">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : list.items.length === 0 ? (
          <p className="text-[14.5px] text-muted-foreground">Learners have rated this course but not written about it yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border" data-testid="reviews-list">
            {list.items.map((r) => (
              <ReviewRow key={r.id} review={r} />
            ))}
          </ul>
        )}
        {list.hasNextPage ? (
          <div className="pt-6">
            <Button variant="outline" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} data-testid="reviews-more">
              {list.isFetchingNextPage ? <Spinner size="sm" /> : null}
              More reviews
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const { status } = useAuth();
  const [reporting, setReporting] = useState(false);
  return (
    <li className="py-6" data-testid="review">
      <div className="flex items-center gap-3">
        <UserAvatar user={review.author} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold">{review.author.displayName}</p>
          <p className="flex items-center gap-2 text-[12.5px] text-subtle-foreground">
            <Stars value={review.rating} size={12} />
            <span className="sr-only">Rated {review.rating} out of 5,</span>
            <TimeAgo value={review.createdAt} />
          </p>
        </div>
      </div>
      {review.body ? <p className={cn("mt-3 whitespace-pre-line text-[14.5px] leading-relaxed text-foreground")}>{review.body}</p> : null}
      {review.reply ? (
        <div className="ml-4 mt-4 border-l-2 border-border pl-4">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            {review.reply.by?.displayName ?? "The instructor"} <StaffMark label="Instructor" /> <span className="font-normal text-subtle-foreground">replied</span>
          </p>
          <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-muted-foreground">{review.reply.body}</p>
        </div>
      ) : null}
      {status === "signed-in" && !review.mine ? (
        <button type="button" onClick={() => setReporting(true)} className="mt-3 text-[12.5px] text-subtle-foreground hover:text-foreground hover:underline" data-testid="review-report">
          Report
        </button>
      ) : null}
      <ReportDialog target={reporting ? { type: "REVIEW", id: review.id } : null} onClose={() => setReporting(false)} />
    </li>
  );
}
