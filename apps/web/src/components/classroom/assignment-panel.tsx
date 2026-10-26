"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, RotateCw, X } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import type { AssignmentView, ItemContent, Submission, SubmissionStatus } from "@open-lms/types";
import { Badge, Button, Field, IconButton, Input, Textarea, toast } from "@open-lms/ui";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useUploads } from "@/lib/hooks/use-uploads";
import { qk } from "@/lib/query-keys";
import { fullTimestamp } from "@/lib/time";
import { useClassroom } from "./classroom-context";
import { formatBytes } from "./lecture-doc";

type AssignmentContent = Extract<ItemContent, { kind: "ASSIGNMENT" }>;

const STATUS: Record<SubmissionStatus, { label: string; tone: "primary" | "success" | "warning" | "danger" }> = {
  SUBMITTED: { label: "Waiting for review", tone: "primary" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Not approved", tone: "danger" },
};

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Whether the learner may submit now, and if not, why. */
export function submitState(a: Pick<AssignmentView, "submissions" | "dueAt" | "allowLate">, now = Date.now()): { open: true; late: boolean } | { open: false; reason: "PENDING" | "APPROVED" | "PAST_DUE" } {
  const latest = a.submissions[0];
  if (latest?.status === "SUBMITTED") return { open: false, reason: "PENDING" };
  if (latest?.status === "APPROVED") return { open: false, reason: "APPROVED" };
  const late = !!a.dueAt && new Date(a.dueAt).getTime() < now;
  if (late && !a.allowLate) return { open: false, reason: "PAST_DUE" };
  return { open: true, late };
}

export function AssignmentPanel({ content }: { content: AssignmentContent }) {
  const a = content.assignment;
  const submissions = [...a.submissions].sort((x, y) => y.version - x.version);
  const state = submitState({ ...a, submissions });
  const facts = [
    `${a.maxPoints} points`,
    a.passPoints !== null ? `Pass at ${a.passPoints}` : null,
    a.dueAt ? `Due ${when(a.dueAt)}` : "No due date",
    a.dueAt ? (a.allowLate ? "Late work accepted and marked late" : "No late submissions") : null,
  ].filter(Boolean);

  return (
    <section className="rounded-card bg-card px-5 py-6 shadow-card sm:px-8 sm:py-8" data-testid="assignment">
      <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-primary">Assignment</p>
      <p className="mt-2 text-[13px] text-muted-foreground">{facts.join(" · ")}</p>
      <div className="lms-prose mt-5 max-w-[720px]" dangerouslySetInnerHTML={{ __html: a.instructionsHtml }} />

      {a.rubric.length ? (
        <div className="mt-8">
          <h3 className="font-display text-[17px] font-semibold">How it is graded</h3>
          <table className="mt-3 w-full text-left text-[14px]" data-testid="assignment-rubric">
            <thead>
              <tr className="border-b border-border text-[12.5px] text-muted-foreground">
                <th className="py-2 font-medium">Criterion</th>
                <th className="w-24 py-2 text-right font-medium">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {a.rubric.map((c) => (
                <tr key={c.id}>
                  <td className="py-3 pr-4 align-top">
                    <p className="font-medium">{c.title}</p>
                    {c.description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{c.description}</p> : null}
                  </td>
                  <td className="py-3 text-right align-top tabular-nums">{c.maxPoints}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td className="py-2 font-semibold">Total</td>
                <td className="py-2 text-right font-semibold tabular-nums">{a.maxPoints}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <div className="mt-8 border-t border-border pt-6">
        {state.open ? (
          <Composer content={content} late={state.late} resubmit={submissions.length > 0} />
        ) : (
          <p className="text-[14.5px] text-muted-foreground" role="status" data-testid="assignment-closed">
            {state.reason === "PENDING"
              ? "Your submission is with the reviewer. You can submit again if they ask for changes."
              : state.reason === "APPROVED"
                ? "Your work is approved. Nice work."
                : "The due date has passed and this assignment does not accept late work."}
          </p>
        )}
      </div>

      {submissions.length ? (
        <div className="mt-8">
          <h3 className="font-display text-[17px] font-semibold">Your submissions</h3>
          <ol className="mt-3 divide-y divide-border border-y border-border">
            {submissions.map((s) => (
              <SubmissionRow key={s.id} submission={s} rubric={a.rubric} maxPoints={a.maxPoints} />
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function Composer({ content, late, resubmit }: { content: AssignmentContent; late: boolean; resubmit: boolean }) {
  const a = content.assignment;
  const itemId = content.item.id;
  const { slug } = useClassroom();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const uploads = useUploads("SUBMISSION", { max: Math.max(1, a.accepts.maxFiles) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      api().assignments.submit(itemId, {
        body: a.accepts.text && body.trim() ? body : null,
        url: a.accepts.url && url.trim() ? url.trim() : null,
        uploadIds: a.accepts.files && uploads.mediaIds.length ? uploads.mediaIds : undefined,
      }),
    meta: { silent: true },
    onSuccess: () => {
      toast.success({ title: "Submitted. You will be notified when it is reviewed." });
      setBody("");
      setUrl("");
      uploads.reset();
      void qc.invalidateQueries({ queryKey: qk.item(itemId) });
      void qc.invalidateQueries({ queryKey: qk.submissions(itemId) });
      void qc.invalidateQueries({ queryKey: qk.classroom(slug) });
    },
    onError: (e) => {
      setError(errorMessage(e));
      if (isApiError(e) && ["SUBMISSION_PENDING", "ALREADY_APPROVED", "PAST_DUE"].includes(e.code)) void qc.invalidateQueries({ queryKey: qk.item(itemId) });
    },
  });

  const empty = !body.trim() && !url.trim() && uploads.mediaIds.length === 0;
  const urlError = submit.error && isApiError(submit.error) ? submit.error.fieldErrors.url : undefined;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (empty) {
          setError("Add some work before submitting: text, a link or a file.");
          return;
        }
        submit.mutate();
      }}
      className="space-y-5"
      data-testid="assignment-composer"
    >
      <h3 className="font-display text-[17px] font-semibold">{resubmit ? "Submit a new version" : "Your submission"}</h3>
      {late ? <p className="text-[13.5px] text-warning-soft-foreground">The due date has passed. This submission will be marked late.</p> : null}

      {a.accepts.text ? (
        <div>
          <UnderlineTabs
            size="sm"
            label="Answer editor"
            tabs={[
              { value: "write", label: "Write" },
              { value: "preview", label: "Preview" },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === "write" ? (
            <>
              <label htmlFor="submission-body" className="sr-only">
                Your answer
              </label>
              <Textarea id="submission-body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your answer. Markdown works: **bold**, lists, `code`." className="mt-3 font-mono text-[13.5px]" data-testid="assignment-body" />
            </>
          ) : (
            // Shown as plain text: the server renders the markdown safely once it is submitted.
            <div className="mt-3 min-h-[200px] whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{body.trim() ? body : <span className="text-muted-foreground">Nothing to preview yet.</span>}</div>
          )}
        </div>
      ) : null}

      {a.accepts.url ? (
        <Field label="Link" htmlFor="submission-url" hint="A repository, a document or a hosted demo." optional={a.accepts.text || a.accepts.files} error={urlError}>
          <Input id="submission-url" type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!urlError} data-testid="assignment-url" />
        </Field>
      ) : null}

      {a.accepts.files ? (
        <div>
          <p className="text-sm font-medium">Files</p>
          <p className="text-[12.5px] text-muted-foreground">Up to {a.accepts.maxFiles} {a.accepts.maxFiles === 1 ? "file" : "files"}: PDF, images, documents.</p>
          {uploads.items.length ? (
            <ul className="mt-2 divide-y divide-border border-y border-border">
              {uploads.items.map((u) => (
                <li key={u.localId} className="flex items-center gap-3 py-2.5 text-[14px]">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{u.file.name}</span>
                  {u.status === "uploading" ? (
                    <span className="w-28 shrink-0">
                      <span className="block h-1 overflow-hidden rounded-full bg-ground-2" role="progressbar" aria-label={`Uploading ${u.file.name}`} aria-valuenow={Math.round(u.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                        <span className="block h-full bg-brand transition-[width]" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                      </span>
                    </span>
                  ) : u.status === "error" ? (
                    <span className="flex items-center gap-1 text-[12.5px] text-danger">
                      {u.error}
                      <IconButton label="Retry upload" size="sm" onClick={() => uploads.retry(u.localId)}>
                        <RotateCw />
                      </IconButton>
                    </span>
                  ) : (
                    <span className="text-[12.5px] text-muted-foreground">{formatBytes(u.file.size)}</span>
                  )}
                  <IconButton label={`Remove ${u.file.name}`} size="sm" onClick={() => uploads.remove(u.localId)}>
                    <X />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            multiple={a.accepts.maxFiles > 1}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              if (e.target.files) uploads.add(e.target.files);
              e.target.value = "";
            }}
            data-testid="assignment-file-input"
          />
          {uploads.items.length < a.accepts.maxFiles ? (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => fileRef.current?.click()}>
              <Paperclip /> Attach files
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-[13.5px] font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={submit.isPending} disabled={uploads.busy} data-testid="assignment-submit">
        {uploads.busy ? "Uploading" : resubmit ? "Submit new version" : "Submit"}
      </Button>
    </form>
  );
}

function SubmissionRow({ submission: s, rubric, maxPoints }: { submission: Submission; rubric: AssignmentView["rubric"]; maxPoints: number }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[s.status];
  return (
    <li className="py-4" data-testid="submission-row">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left">
        <span className="font-semibold">Version {s.version}</span>
        <span className="text-[13px] text-muted-foreground" title={fullTimestamp(s.submittedAt)}>
          {when(s.submittedAt)}
          {s.isLate ? " · Late" : ""}
        </span>
        <Badge tone={status.tone}>{status.label}</Badge>
        {s.review ? (
          <span className="ml-auto text-[14px] font-semibold tabular-nums">
            {s.review.totalPoints} / {maxPoints}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-3 space-y-3">
          {s.bodyHtml ? <div className="lms-prose text-[14.5px]" dangerouslySetInnerHTML={{ __html: s.bodyHtml }} /> : s.body ? <p className="whitespace-pre-wrap text-[14.5px]">{s.body}</p> : null}
          {s.url ? (
            <p className="text-[14px]">
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-link hover:underline">
                {s.url}
              </a>
            </p>
          ) : null}
          {s.files.length ? (
            <ul className="space-y-1 text-[14px]">
              {s.files.map((f) => (
                <li key={f.id}>
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-link hover:underline">
                    <FileText className="size-4" aria-hidden /> {f.fileName}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {s.review ? (
        <div className="mt-4 border-l-2 border-brand pl-4">
          <p className="text-[12.5px] font-semibold text-muted-foreground">
            Reviewed{s.review.reviewer ? ` by ${s.review.reviewer.displayName}` : ""} · {when(s.review.reviewedAt)}
          </p>
          {rubric.length ? (
            <table className="mt-2 w-full max-w-md text-[13.5px]">
              <tbody className="divide-y divide-border">
                {rubric.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 pr-3">{c.title}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {s.review!.scores[c.id] ?? 0} / {c.maxPoints}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {s.review.feedbackHtml ? <div className="lms-prose mt-3 text-[14.5px]" dangerouslySetInnerHTML={{ __html: s.review.feedbackHtml }} /> : null}
        </div>
      ) : null}
    </li>
  );
}
