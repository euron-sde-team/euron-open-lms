"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Sparkles } from "lucide-react";
import { isApiError, type GradingReviewInput } from "@open-lms/api-client";
import { Badge, Button, Input, Skeleton, Tooltip, cn, toast } from "@open-lms/ui";
import type { GradingDetail } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useAcademyMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { fullTimestamp } from "@/lib/time";
import { ErrorState } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar } from "@/components/common/user-bits";
import { AdminPage } from "@/components/admin/shell/admin-page";
import { useUrlState } from "@/components/admin/shell/url-state";
import { MarkdownField } from "@/components/admin/courses/course-bits";
import { ServerHtml } from "@/components/admin/courses/markdown-preview";
import { scoreSummary, type ScoreSummary } from "@/components/admin/courses/authoring-model";
import { SUBMISSION_LABEL, SUBMISSION_TONE, gradingHref } from "./grading-queue";

type Decision = GradingReviewInput["decision"];

/** Why a decision can not be sent yet, or null. */
export function decisionProblem(decision: Decision, s: ScoreSummary, feedback: string, passPoints: number | null): string | null {
  if (s.invalid.length) return "Fix the scores that are out of range.";
  if (decision === "APPROVED") {
    if (!s.complete) return "Score every criterion before approving.";
    if (passPoints !== null && s.total < passPoints) return `Approving needs at least ${passPoints} points.`;
  } else if (!feedback.trim()) return decision === "CHANGES_REQUESTED" ? "Tell the learner what to change." : "Tell the learner why it is rejected.";
  return null;
}

const detailKey = (id: string) => qk.admin.detail("grading", id);

export function GradingDetailPage({ submissionId }: { submissionId: string }) {
  const q = useQuery({ queryKey: detailKey(submissionId), queryFn: () => api().grading.get(submissionId) });
  if (q.isPending) return <DetailSkeleton />;
  if (q.error || !q.data) {
    return (
      <AdminPage title="Submission" back={{ href: "/admin/grading", label: "Grading" }}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </AdminPage>
    );
  }
  return <Detail key={q.data.submissionId} detail={q.data} />;
}

function Detail({ detail }: { detail: GradingDetail }) {
  const qc = useQueryClient();
  const router = useRouter();
  const url = useUrlState();
  const courseFilter = url.get("course") || null;
  const meta = useAcademyMeta();
  const id = useId();
  const firstScore = useRef<HTMLInputElement>(null);
  const open = detail.status === "SUBMITTED";
  const [scores, setScores] = useState<Record<string, string>>(() =>
    Object.fromEntries(detail.rubric.map((c) => [c.id, detail.review?.scores[c.id] !== undefined ? String(detail.review.scores[c.id]) : ""])),
  );
  const [feedback, setFeedback] = useState(detail.review?.feedback ?? "");
  const [attempted, setAttempted] = useState<Decision | null>(null);
  const summary = scoreSummary(detail.rubric, scores, detail.passPoints);
  const suggestion = detail.aiSuggestion;
  useEffect(() => {
    if (open) firstScore.current?.focus();
  }, [open]);

  const next = async () => {
    const page = await api().grading.list({ status: "SUBMITTED", courseId: courseFilter ?? undefined, limit: 5 });
    const n = page.items.find((r) => r.submissionId !== detail.submissionId);
    if (n) router.push(gradingHref(n.submissionId, courseFilter));
    else {
      toast.success({ title: "The queue is clear." });
      router.push(`/admin/grading${courseFilter ? `?course=${encodeURIComponent(courseFilter)}` : ""}`);
    }
  };

  const review = useMutation({
    mutationFn: (decision: Decision) => {
      const valid = Object.fromEntries(detail.rubric.flatMap((c) => (scores[c.id]?.trim() ? [[c.id, Number(scores[c.id])]] : [])));
      return api().grading.review(detail.submissionId, { decision, scores: valid, feedback: feedback.trim() || null });
    },
    meta: { silent: true },
    onSuccess: (d, decision) => {
      qc.setQueryData(detailKey(d.submissionId), d);
      void qc.invalidateQueries({ queryKey: qk.admin.list("grading") });
      toast.success({ title: decision === "APPROVED" ? "Approved. The learner is notified." : decision === "CHANGES_REQUESTED" ? "Changes requested. The learner is notified." : "Rejected. The learner is notified." });
      void next();
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "ALREADY_REVIEWED") void qc.invalidateQueries({ queryKey: detailKey(detail.submissionId) });
      toast.error({ title: errorMessage(e) });
    },
  });
  const suggest = useMutation({
    mutationFn: () => api().grading.aiSuggestion(detail.submissionId),
    onSuccess: (d) => qc.setQueryData(detailKey(d.submissionId), d),
  });
  const apply = () => {
    if (!suggestion) return;
    setScores(Object.fromEntries(detail.rubric.map((c) => [c.id, suggestion.scores[c.id] !== undefined ? String(suggestion.scores[c.id]) : scores[c.id] ?? ""])));
    setFeedback(suggestion.feedback);
    toast.info({ title: "Suggestion applied to the form. Review it, then decide." });
  };
  const decide = (d: Decision) => {
    setAttempted(d);
    if (!decisionProblem(d, summary, feedback, detail.passPoints)) review.mutate(d);
  };
  const problem = attempted ? decisionProblem(attempted, summary, feedback, detail.passPoints) : null;
  const aiOn = !!meta.data?.ai.gradingAssist;

  return (
    <AdminPage
      testId="grading-detail"
      back={{ href: `/admin/grading${courseFilter ? `?course=${encodeURIComponent(courseFilter)}` : ""}`, label: "Grading" }}
      title={detail.item.title}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={SUBMISSION_TONE[detail.status]}>{SUBMISSION_LABEL[detail.status]}</Badge>
          <span>{detail.course.title}</span>
        </span>
      }
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-8">
          <div className="flex items-center gap-3">
            <UserAvatar user={detail.learner} />
            <div className="min-w-0">
              <p className="font-medium">{detail.learner.displayName}</p>
              <p className="text-[13px] text-muted-foreground">
                {detail.version > 1 ? `Resubmission ${detail.version}` : "First submission"} · <span title={fullTimestamp(detail.submittedAt)}>submitted <TimeAgo value={detail.submittedAt} /></span>
                {detail.isLate ? <span className="font-medium text-warning-soft-foreground"> · Late</span> : null}
              </p>
            </div>
          </div>

          <section aria-labelledby={`${id}-sub`} data-testid="submission-body">
            <h2 id={`${id}-sub`} className="mb-3 font-display text-[18px] font-semibold tracking-[-0.015em]">
              Submission
            </h2>
            {detail.bodyHtml ? <ServerHtml html={detail.bodyHtml} /> : detail.body ? <p className="whitespace-pre-wrap text-[15px]">{detail.body}</p> : null}
            {detail.url ? (
              <p className="mt-3 text-sm">
                <a href={detail.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-link hover:underline" data-testid="submission-url">
                  {detail.url} <ExternalLink className="size-3.5" aria-hidden />
                </a>
              </p>
            ) : null}
            {detail.files.length ? (
              <ul className="mt-4 divide-y divide-border border-y border-border" aria-label="Files">
                {detail.files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                    {f.sizeBytes ? <span className="text-[12.5px] text-muted-foreground">{(f.sizeBytes / 1024 / 1024).toFixed(1)} MB</span> : null}
                    <Button asChild size="sm" variant="ghost">
                      <a href={f.url} download={f.fileName} target="_blank" rel="noopener noreferrer" data-testid="submission-file">
                        <Download /> Download
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {!detail.bodyHtml && !detail.body && !detail.url && !detail.files.length ? <p className="text-sm text-muted-foreground">This submission is empty.</p> : null}
          </section>

          <details className="group border-t border-border pt-4">
            <summary className="cursor-pointer text-[14px] font-medium text-muted-foreground hover:text-foreground">Assignment instructions</summary>
            <div className="mt-3">
              <ServerHtml html={detail.instructionsHtml} className="text-[14.5px]" />
            </div>
          </details>

          {detail.previousVersions.length ? (
            <section aria-labelledby={`${id}-prev`} className="border-t border-border pt-4">
              <h2 id={`${id}-prev`} className="mb-2 text-[14px] font-semibold">
                Earlier versions
              </h2>
              <ul className="divide-y divide-border">
                {detail.previousVersions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-3 py-2 text-sm">
                    <a href={gradingHref(v.id, courseFilter)} className="font-medium hover:underline">
                      Version {v.version}
                    </a>
                    <span className="text-muted-foreground">
                      {SUBMISSION_LABEL[v.status]}
                      {v.totalPoints !== null ? ` · ${v.totalPoints} points` : ""} · <TimeAgo value={v.submittedAt} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside aria-labelledby={`${id}-score`} className="lg:sticky lg:top-6 lg:self-start lg:border-l lg:border-border lg:pl-6" data-testid="rubric-panel">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              decide("APPROVED");
            }}
            noValidate
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 id={`${id}-score`} className="font-display text-[18px] font-semibold tracking-[-0.015em]">
                {open ? "Score" : "Review"}
              </h2>
              <p className="text-[13.5px] tabular-nums" aria-live="polite" data-testid="score-total">
                <span className="font-display text-[22px] font-semibold">{summary.total}</span>
                <span className="text-muted-foreground"> / {summary.max}</span>
                {detail.passPoints !== null ? <span className={cn("ml-2", summary.passes ? "text-success" : "text-muted-foreground")}>pass {detail.passPoints}</span> : null}
              </p>
            </div>
            {!open && detail.review ? (
              <p className="mt-1 text-[13px] text-muted-foreground">
                {SUBMISSION_LABEL[detail.status]}
                {detail.review.reviewer ? ` by ${detail.review.reviewer.displayName}` : ""} <TimeAgo value={detail.review.reviewedAt} />
              </p>
            ) : null}

            {open && aiOn ? (
              <div className="mt-4 border-y border-border py-3" data-testid="ai-suggestion">
                {suggestion ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[13px] font-medium">
                        <Sparkles className="size-4 text-primary" aria-hidden /> AI suggestion
                      </p>
                      <Button size="sm" variant="ghost" onClick={apply} data-testid="ai-apply">
                        Apply suggestion
                      </Button>
                    </div>
                    <p className="mt-1 text-[12.5px] text-subtle-foreground">A draft to start from. You make the decision.</p>
                    <p className="mt-2 line-clamp-6 whitespace-pre-wrap text-[13.5px] text-muted-foreground">{suggestion.feedback}</p>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] text-muted-foreground">Get suggested scores and feedback to start from.</p>
                    <Button size="sm" variant="ghost" onClick={() => suggest.mutate()} loading={suggest.isPending} data-testid="ai-request">
                      <Sparkles /> Suggest
                    </Button>
                  </div>
                )}
              </div>
            ) : null}

            <ol className="mt-4 divide-y divide-border border-y border-border">
              {detail.rubric.map((c, i) => {
                const bad = summary.invalid.includes(c.id);
                const sid = `${id}-c-${c.id}`;
                return (
                  <li key={c.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <label htmlFor={sid} className="text-sm font-medium">
                        {c.title}
                      </label>
                      {c.description ? <p className="text-[12.5px] text-muted-foreground">{c.description}</p> : null}
                      {suggestion && open && suggestion.scores[c.id] !== undefined ? <p className="text-[12.5px] text-primary">AI suggests {suggestion.scores[c.id]}</p> : null}
                      {bad ? <p className="text-xs font-medium text-danger">A whole number from 0 to {c.maxPoints}.</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Input
                        ref={i === 0 ? firstScore : undefined}
                        id={sid}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={c.maxPoints}
                        step={1}
                        className="w-20 text-right tabular-nums"
                        value={scores[c.id] ?? ""}
                        disabled={!open}
                        aria-invalid={bad || undefined}
                        aria-describedby={`${sid}-max`}
                        onChange={(e) => setScores((s) => ({ ...s, [c.id]: e.target.value }))}
                        data-testid={`score-${i}`}
                      />
                      <span id={`${sid}-max`} className="w-10 text-[13px] text-muted-foreground">
                        / {c.maxPoints}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-4">
              {open ? (
                <>
                  <label htmlFor={`${id}-fb`} className="mb-1 block text-sm font-medium">
                    Feedback
                  </label>
                  <MarkdownField id={`${id}-fb`} value={feedback} onChange={setFeedback} rows={6} maxLength={20000} placeholder="What works, and what to improve" testId="grading-feedback" />
                </>
              ) : detail.review?.feedback ? (
                <>
                  <p className="mb-1 text-sm font-medium">Feedback</p>
                  <p className="whitespace-pre-wrap text-[14px] text-muted-foreground">{detail.review.feedback}</p>
                </>
              ) : null}
            </div>

            {open ? (
              <div className="mt-4 space-y-2">
                {problem ? (
                  <p role="alert" className="text-[13px] font-medium text-danger" data-testid="decision-problem">
                    {problem}
                  </p>
                ) : null}
                <Button type="submit" block loading={review.isPending && review.variables === "APPROVED"} disabled={review.isPending} data-testid="decide-approve">
                  Approve
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => decide("CHANGES_REQUESTED")} loading={review.isPending && review.variables === "CHANGES_REQUESTED"} disabled={review.isPending} data-testid="decide-changes">
                    Request changes
                  </Button>
                  <Tooltip content="Ends this assignment for the learner without a pass">
                    <Button variant="danger-ghost" onClick={() => decide("REJECTED")} loading={review.isPending && review.variables === "REJECTED"} disabled={review.isPending} data-testid="decide-reject">
                      Reject
                    </Button>
                  </Tooltip>
                </div>
                <p className="text-[12px] text-subtle-foreground">Tab moves through the scores. Enter approves. The next submission opens after you decide.</p>
              </div>
            ) : (
              <Button variant="outline" block className="mt-4" onClick={() => void next()} data-testid="grading-next">
                Next waiting submission
              </Button>
            )}
          </form>
        </aside>
      </div>
    </AdminPage>
  );
}

function DetailSkeleton() {
  return (
    <AdminPage title={<Skeleton className="h-8 w-72" />} back={{ href: "/admin/grading", label: "Grading" }}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]" aria-busy>
        <div className="space-y-3">
          <Skeleton className="h-10 w-60" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </AdminPage>
  );
}
