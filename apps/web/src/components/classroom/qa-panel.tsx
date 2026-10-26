"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Flag, MessageCircleQuestion, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import type { QaReply, QaThread, QaThreadDetail, ReportReason, ReportTarget } from "@open-lms/types";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  NativeSelect,
  Skeleton,
  Textarea,
  toast,
} from "@open-lms/ui";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState, LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { StaffMark, UserAvatar } from "@/components/common/user-bits";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { useClassroom } from "./classroom-context";

type Sort = "recent" | "unanswered";

/** Text for an edit box from the server's sanitized HTML (the API keeps the source; we only get HTML). */
function htmlToText(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]*>/g, "");
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n"), "text/html");
  return (doc.body.textContent ?? "").trim();
}

export function QaPanel({ itemId }: { itemId: string }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  return (
    <div className="max-w-[760px]" data-testid="classroom-qa">
      {threadId ? <ThreadView threadId={threadId} onBack={() => setThreadId(null)} /> : <ThreadList itemId={itemId} onOpen={setThreadId} />}
    </div>
  );
}

function ThreadList({ itemId, onOpen }: { itemId: string; onOpen: (id: string) => void }) {
  const { classroom } = useClassroom();
  const courseId = classroom.course.id;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [asking, setAsking] = useState(false);
  const q = useDebounced(search.trim(), 300);
  const filters = { itemId, q, sort };
  const list = usePagedList<QaThread>({ queryKey: qk.questions(courseId, filters), fetchPage: (cursor) => api().community.questions(courseId, { ...filters, q: q || undefined, cursor, limit: 20 }) });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions on this lesson" aria-label="Search questions" className="pl-9" data-testid="qa-search" />
        </div>
        {!asking ? (
          <Button variant="outline" onClick={() => setAsking(true)} data-testid="qa-ask">
            Ask a question
          </Button>
        ) : null}
      </div>
      {asking ? <AskForm itemId={itemId} onDone={(t) => {
            setAsking(false);
            if (t) onOpen(t.id);
          }} /> : null}
      <UnderlineTabs
        size="sm"
        className="mt-5"
        label="Sort questions"
        tabs={[
          { value: "recent", label: "Recent" },
          { value: "unanswered", label: "Unanswered" },
        ]}
        value={sort}
        onChange={setSort}
      />
      {list.isPending ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState compact error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.items.length ? (
        <EmptyState compact icon={<MessageCircleQuestion />} title={q ? "No questions match that search" : "No questions on this lesson yet"} description={q ? "Try other words, or ask it yourself." : "Stuck on something? Ask, and the instructor or other learners can answer."} />
      ) : (
        <ul className="divide-y divide-border border-b border-border">
          {list.items.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onOpen(t.id)} className="flex w-full items-start gap-3 py-3.5 text-left hover:bg-muted/50" data-testid="qa-thread-row">
                <UserAvatar user={t.author} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{t.title}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                    {t.author.displayName} · <TimeAgo value={t.lastActivityAt} /> · {t.replyCount} {t.replyCount === 1 ? "reply" : "replies"}
                  </span>
                </span>
                {t.answered ? (
                  <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-success">
                    <CheckCircle2 className="size-4" aria-hidden /> Answered
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
    </div>
  );
}

function AskForm({ itemId, onDone }: { itemId: string; onDone: (t: QaThread | null) => void }) {
  const { classroom } = useClassroom();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const ask = useMutation({
    mutationFn: () => api().community.ask(classroom.course.id, { title: title.trim(), body: body.trim(), itemId }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: qk.questionsAll });
      toast.success({ title: "Question posted" });
      onDone(t);
    },
  });
  return (
    <form
      className="mt-4 space-y-3 border-b border-border pb-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && body.trim()) ask.mutate();
      }}
      data-testid="qa-ask-form"
    >
      <Field label="Your question" htmlFor="qa-title">
        <Input id="qa-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="One line that sums it up" autoFocus />
      </Field>
      <Field label="Details" htmlFor="qa-body" hint="What did you try? Mention the time in the video if it helps.">
        <Textarea id="qa-body" rows={5} value={body} maxLength={10000} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={ask.isPending} disabled={!title.trim() || !body.trim()} data-testid="qa-post">
          Post question
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ThreadView({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.thread(threadId), queryFn: () => api().community.question(threadId) });
  const [reply, setReply] = useState("");
  const [editingQ, setEditingQ] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "thread" } | { kind: "reply"; reply: QaReply } | null>(null);
  const [report, setReport] = useState<{ type: ReportTarget; id: string } | null>(null);

  const setThread = (fn: (t: QaThreadDetail) => QaThreadDetail) => qc.setQueryData<QaThreadDetail>(qk.thread(threadId), (t) => (t ? fn(t) : t));
  const touchList = () => void qc.invalidateQueries({ queryKey: qk.questionsAll });

  const send = useMutation({
    mutationFn: (body: string) => api().community.reply(threadId, body),
    onSuccess: (r) => {
      setThread((t) => ({ ...t, replies: [...t.replies, r], replyCount: t.replyCount + 1 }));
      setReply("");
      touchList();
    },
  });
  const accept = useMutation({
    mutationFn: (replyId: string | null) => api().community.accept(threadId, replyId),
    onMutate: (replyId) => {
      const prev = qc.getQueryData<QaThreadDetail>(qk.thread(threadId));
      setThread((t) => ({ ...t, answered: replyId !== null, replies: t.replies.map((r) => ({ ...r, accepted: r.id === replyId })) }));
      return { prev };
    },
    onSuccess: (t) => {
      qc.setQueryData(qk.thread(threadId), t);
      touchList();
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.thread(threadId), ctx.prev),
  });
  const editQuestion = useMutation({
    mutationFn: (v: { title: string; body: string }) => api().community.editQuestion(threadId, v),
    onSuccess: (t) => {
      setThread((d) => ({ ...d, ...t }));
      setEditingQ(false);
      touchList();
    },
  });
  const editReply = useMutation({
    mutationFn: (v: { id: string; body: string }) => api().community.editReply(v.id, v.body),
    onSuccess: (r) => setThread((t) => ({ ...t, replies: t.replies.map((x) => (x.id === r.id ? r : x)) })),
  });

  if (q.isPending) return <Skeleton className="h-48 w-full" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const t = q.data;

  return (
    <article data-testid="qa-thread">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-3">
        <ArrowLeft /> All questions
      </Button>
      {editingQ ? (
        <EditQuestion thread={t} saving={editQuestion.isPending} onSave={(v) => editQuestion.mutate(v)} onCancel={() => setEditingQ(false)} />
      ) : (
        <div className="flex items-start gap-3">
          <UserAvatar user={t.author} />
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[19px] font-semibold leading-snug tracking-[-0.01em]">{t.title}</h3>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {t.author.displayName} · <TimeAgo value={t.createdAt} />
              {t.item ? ` · ${t.item.title}` : ""}
            </p>
            <div className="lms-prose mt-3 text-[14.5px]" dangerouslySetInnerHTML={{ __html: t.bodyHtml }} />
          </div>
          <PostMenu mine={t.mine} onEdit={() => setEditingQ(true)} onDelete={() => setConfirm({ kind: "thread" })} onReport={() => setReport({ type: "QA_THREAD", id: t.id })} />
        </div>
      )}

      <h4 className="mt-8 text-[13px] font-semibold text-muted-foreground">
        {t.replies.length} {t.replies.length === 1 ? "reply" : "replies"}
      </h4>
      <ul className="mt-2 divide-y divide-border border-y border-border">
        {t.replies.map((r) => (
          <ReplyRow
            key={r.id}
            reply={r}
            canAccept={t.canAccept}
            onAccept={() => accept.mutate(r.accepted ? null : r.id)}
            onSave={(body) => editReply.mutate({ id: r.id, body })}
            onDelete={() => setConfirm({ kind: "reply", reply: r })}
            onReport={() => setReport({ type: "QA_REPLY", id: r.id })}
          />
        ))}
      </ul>

      <form
        className="mt-5 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (reply.trim()) send.mutate(reply.trim());
        }}
      >
        <label htmlFor="qa-reply" className="sr-only">
          Your reply
        </label>
        <Textarea id="qa-reply" rows={3} value={reply} maxLength={10000} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply" data-testid="qa-reply-body" />
        <Button type="submit" size="sm" loading={send.isPending} disabled={!reply.trim()} data-testid="qa-reply-send">
          Reply
        </Button>
      </form>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === "thread" ? `Delete "${t.title}"?` : "Delete this reply?"}
        description={confirm?.kind === "thread" ? "The question and its replies will be removed." : "Your reply will be removed from the thread."}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (confirm?.kind === "thread") {
            await api().community.deleteQuestion(threadId);
            touchList();
            onBack();
          } else if (confirm?.kind === "reply") {
            const id = confirm.reply.id;
            await api().community.deleteReply(id);
            setThread((d) => ({ ...d, replies: d.replies.filter((x) => x.id !== id), replyCount: Math.max(0, d.replyCount - 1) }));
          }
        }}
      />
      <ReportDialog target={report} onClose={() => setReport(null)} />
    </article>
  );
}

function EditQuestion({ thread, saving, onSave, onCancel }: { thread: QaThreadDetail; saving: boolean; onSave: (v: { title: string; body: string }) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(thread.title);
  const [body, setBody] = useState(() => htmlToText(thread.bodyHtml));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && body.trim()) onSave({ title: title.trim(), body: body.trim() });
      }}
    >
      <Field label="Question" htmlFor="qa-edit-title">
        <Input id="qa-edit-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Details" htmlFor="qa-edit-body">
        <Textarea id="qa-edit-body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={saving}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReplyRow({ reply: r, canAccept, onAccept, onSave, onDelete, onReport }: { reply: QaReply; canAccept: boolean; onAccept: () => void; onSave: (body: string) => void; onDelete: () => void; onReport: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <li className="flex items-start gap-3 py-4" data-testid="qa-reply">
      <UserAvatar user={r.author} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="font-semibold">{r.author.displayName}</span>
          {r.isStaff ? <StaffMark /> : null}
          <span className="text-muted-foreground">
            · <TimeAgo value={r.createdAt} />
          </span>
          {r.accepted ? (
            <span className="ml-1 flex items-center gap-1 font-medium text-success" data-testid="qa-accepted">
              <CheckCircle2 className="size-4" aria-hidden /> Accepted answer
            </span>
          ) : null}
        </p>
        {editing ? (
          <form
            className="mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) onSave(draft.trim());
              setEditing(false);
            }}
          >
            <label htmlFor={`reply-edit-${r.id}`} className="sr-only">
              Edit reply
            </label>
            <Textarea id={`reply-edit-${r.id}`} rows={3} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="mt-2 flex gap-2">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="lms-prose mt-1 text-[14.5px]" dangerouslySetInnerHTML={{ __html: r.bodyHtml }} />
        )}
        {canAccept && !editing ? (
          <Button variant="link" className="mt-2 text-[13px]" onClick={onAccept} data-testid="qa-accept">
            {r.accepted ? "Unmark as the answer" : "Mark as the answer"}
          </Button>
        ) : null}
      </div>
      {!editing ? (
        <PostMenu
          mine={r.mine}
          onEdit={() => {
            setDraft(htmlToText(r.bodyHtml));
            setEditing(true);
          }}
          onDelete={onDelete}
          onReport={onReport}
        />
      ) : null}
    </li>
  );
}

function PostMenu({ mine, onEdit, onDelete, onReport }: { mine: boolean; onEdit: () => void; onDelete: () => void; onReport: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Post actions" size="sm" data-testid="qa-post-menu">
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[160px]">
        {mine ? (
          <>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={onReport}>
            <Flag /> Report
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "SPAM", label: "Spam or advertising" },
  { value: "HARASSMENT", label: "Harassment" },
  { value: "OFF_TOPIC", label: "Off topic" },
  { value: "SPOILER", label: "Gives away quiz or assignment answers" },
  { value: "INAPPROPRIATE", label: "Inappropriate" },
  { value: "OTHER", label: "Something else" },
];

export function ReportDialog({ target, onClose }: { target: { type: ReportTarget; id: string } | null; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>("SPAM");
  const [note, setNote] = useState("");
  const report = useMutation({
    mutationFn: () => api().community.report({ targetType: target!.type, targetId: target!.id, reason, note: note.trim() || null }),
    onSuccess: () => {
      toast.success({ title: "Thanks. A moderator will take a look." });
      setNote("");
      onClose();
    },
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" data-testid="report-dialog">
        <DialogHeader>
          <DialogTitle>Report this post</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label="Reason" htmlFor="report-reason">
            <NativeSelect id="report-reason" value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Anything else" htmlFor="report-note" optional>
            <Textarea id="report-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => report.mutate()} loading={report.isPending} data-testid="report-submit">
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
