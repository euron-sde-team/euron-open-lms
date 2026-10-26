"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import type { ItemContent, ReviewEligibility } from "@open-lms/types";
import { Button, Textarea, cn, toast } from "@open-lms/ui";
import { courseHref } from "@/components/course/course-card";
import { Stars } from "@/components/course/stars";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useClassroom } from "./classroom-context";

export function OverviewPanel({ content }: { content: ItemContent }) {
  const { slug, classroom } = useClassroom();
  const notesHtml = content.kind === "LECTURE" && content.lecture.lectureKind !== "ARTICLE" ? content.lecture.notesHtml : null;
  return (
    <div className="max-w-[720px] space-y-8" data-testid="classroom-overview-tab">
      {notesHtml ? (
        <div className="lms-prose" dangerouslySetInnerHTML={{ __html: notesHtml }} />
      ) : (
        <p className="text-[14.5px] text-muted-foreground">
          This lesson is part of {classroom.course.title}.{" "}
          <Link href={courseHref(slug)} className="font-medium text-link hover:underline">
            Read about the course
          </Link>
        </p>
      )}
      {notesHtml ? (
        <p className="text-[13.5px]">
          <Link href={courseHref(slug)} className="font-medium text-link hover:underline">
            About this course
          </Link>
        </p>
      ) : null}
      {classroom.role === "LEARNER" ? <ReviewPrompt courseId={classroom.course.id} /> : null}
    </div>
  );
}

/** A quiet card to rate the course once the learner is eligible; editable later. */
export function ReviewPrompt({ courseId }: { courseId: string }) {
  const q = useQuery({ queryKey: qk.reviewEligibility(courseId), queryFn: () => api().community.reviewEligibility(courseId), staleTime: 5 * 60_000, meta: { silent: true } });
  const [editing, setEditing] = useState(false);
  if (!q.data) return null;
  const e = q.data;
  if (!e.canReview && !e.mine) return null;
  if (e.mine && !editing) {
    return (
      <section className="border-t border-border pt-6" data-testid="review-mine">
        <h3 className="font-display text-[17px] font-semibold">Your review</h3>
        <div className="mt-2 flex items-center gap-3">
          <Stars value={e.mine.rating} size={16} />
          <span className="sr-only">{e.mine.rating} out of 5</span>
          <Button variant="link" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
        {e.mine.body ? <p className="mt-2 whitespace-pre-wrap text-[14.5px] text-muted-foreground">{e.mine.body}</p> : null}
      </section>
    );
  }
  return <ReviewForm courseId={courseId} eligibility={e} onDone={() => setEditing(false)} />;
}

function ReviewForm({ courseId, eligibility, onDone }: { courseId: string; eligibility: ReviewEligibility; onDone: () => void }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(eligibility.mine?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState(eligibility.mine?.body ?? "");
  const save = useMutation({
    mutationFn: () => api().community.saveReview(courseId, { rating, body: body.trim() || null }),
    onSuccess: (review) => {
      qc.setQueryData<ReviewEligibility>(qk.reviewEligibility(courseId), (old) => (old ? { ...old, canReview: false, reason: "ALREADY_REVIEWED", mine: review } : old));
      void qc.invalidateQueries({ queryKey: ["course-reviews"] });
      toast.success({ title: eligibility.mine ? "Review updated" : "Thanks for the review" });
      onDone();
    },
  });
  const shown = hover || rating;
  return (
    <section className="border-t border-border pt-6" data-testid="review-prompt">
      <h3 className="font-display text-[17px] font-semibold">{eligibility.mine ? "Edit your review" : "How is the course going?"}</h3>
      <p className="mt-1 text-[13.5px] text-muted-foreground">Your rating helps other learners choose.</p>
      <div role="radiogroup" aria-label="Rating" className="mt-3 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            className="rounded-full p-0.5"
            data-testid={`review-star-${n}`}
          >
            <Star className={cn("size-7 transition-colors", n <= shown ? "text-star" : "text-border")} fill="currentColor" strokeWidth={0} />
          </button>
        ))}
      </div>
      {rating ? (
        <>
          <label htmlFor="review-body" className="sr-only">
            Your review
          </label>
          <Textarea id="review-body" className="mt-3" rows={4} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="What worked, and what could be better? (optional)" data-testid="review-body" />
          <div className="mt-3 flex gap-2">
            <Button onClick={() => save.mutate()} loading={save.isPending} data-testid="review-save">
              {eligibility.mine ? "Save review" : "Post review"}
            </Button>
            {eligibility.mine ? (
              <Button variant="ghost" onClick={onDone}>
                Cancel
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
