"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, NotebookPen, Pencil, Trash2 } from "lucide-react";
import type { Note, Page } from "@open-lms/types";
import { Button, Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, IconButton, Skeleton, Textarea } from "@open-lms/ui";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { LoadMore } from "@/components/common/states";
import { TimeAgo } from "@/components/common/time-ago";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { api } from "@/lib/api";
import { notesReducer, sortForItem, tempNoteId, type NotesAction } from "@/lib/classroom/notes";
import { clock } from "@/lib/duration";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { learnHref, useClassroom } from "./classroom-context";

export function NotesPanel({ itemId, isVideo }: { itemId: string; isVideo: boolean }) {
  const [scope, setScope] = useState<"item" | "course">("item");
  return (
    <div className="max-w-[720px]" data-testid="classroom-notes">
      <UnderlineTabs
        size="sm"
        label="Which notes"
        tabs={[
          { value: "item", label: "This lesson" },
          { value: "course", label: "All notes in this course" },
        ]}
        value={scope}
        onChange={setScope}
        className="mb-5"
      />
      {scope === "item" ? <ItemNotes itemId={itemId} isVideo={isVideo} /> : <CourseNotes />}
    </div>
  );
}

function ItemNotes({ itemId, isVideo }: { itemId: string; isVideo: boolean }) {
  const { slug, player } = useClassroom();
  const qc = useQueryClient();
  const key = qk.notes(slug, itemId);
  const q = useQuery({ queryKey: key, queryFn: () => api().learn.notes(slug, { itemId, limit: 50 }) });
  const [body, setBody] = useState("");
  const [stamp, setStamp] = useState(true);
  const [atNow, setAtNow] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);

  const update = (action: NotesAction) => qc.setQueryData<Page<Note>>(key, (p) => (p ? { ...p, items: notesReducer(p.items, action) } : p));
  const settle = () => void qc.invalidateQueries({ queryKey: qk.notes(slug) });

  const add = useMutation({
    mutationFn: (v: { body: string; atSeconds: number | null; tempId: string }) => api().learn.addNote(itemId, { body: v.body, atSeconds: v.atSeconds }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const now = new Date().toISOString();
      update({ type: "add", note: { id: v.tempId, itemId, itemTitle: "", atSeconds: v.atSeconds, body: v.body, createdAt: now, updatedAt: now } });
    },
    onSuccess: (note, v) => update({ type: "confirm", tempId: v.tempId, note }),
    onError: (_e, v) => {
      update({ type: "remove", id: v.tempId });
      setBody(v.body);
    },
    onSettled: settle,
  });
  const edit = useMutation({
    mutationFn: (v: { note: Note; body: string }) => api().learn.editNote(v.note.id, { body: v.body }),
    onMutate: (v) => update({ type: "edit", id: v.note.id, patch: { body: v.body }, at: new Date().toISOString() }),
    onSuccess: (note) => update({ type: "replace", note }),
    onError: (_e, v) => update({ type: "replace", note: v.note }),
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (v: { note: Note; index: number }) => api().learn.deleteNote(v.note.id),
    onMutate: (v) => update({ type: "remove", id: v.note.id }),
    onError: (_e, v) => update({ type: "restore", note: v.note, index: v.index }),
    onSettled: settle,
  });

  const capture = () => {
    if (!isVideo) return;
    const t = player.current?.currentTime();
    setAtNow(typeof t === "number" && Number.isFinite(t) ? Math.floor(t) : null);
  };
  const submit = () => {
    const text = body.trim();
    if (!text) return;
    const atSeconds = isVideo && stamp ? (atNow ?? Math.floor(player.current?.currentTime() ?? 0)) : null;
    add.mutate({ body: text, atSeconds, tempId: tempNoteId() });
    setBody("");
    setAtNow(null);
  };

  const notes = sortForItem(q.data?.items ?? []);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-2"
      >
        <label htmlFor="note-body" className="sr-only">
          New note
        </label>
        <Textarea
          id="note-body"
          rows={3}
          value={body}
          onFocus={capture}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={isVideo ? "Write a note. It is pinned to the moment in the video." : "Write a note for this lesson."}
          maxLength={5000}
          data-testid="note-body"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!body.trim()} data-testid="note-add">
            Add note
          </Button>
          {isVideo ? (
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Checkbox checked={stamp} onCheckedChange={(v) => setStamp(v === true)} aria-label="Pin the note to the current video time" />
              {atNow !== null ? `At ${clock(atNow)}` : "At the current time"}
            </label>
          ) : null}
        </div>
      </form>

      <div className="mt-6">
        {q.isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : notes.length === 0 ? (
          <EmptyState compact icon={<NotebookPen />} title="No notes on this lesson yet" description="Notes are private to you." />
        ) : (
          <ul className="divide-y divide-border border-y border-border" aria-live="polite">
            {notes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                onSeek={
                  isVideo && n.atSeconds !== null
                    ? () => {
                        player.current?.seek(n.atSeconds!);
                        document.getElementById("main")?.scrollTo({ top: 0, behavior: "smooth" });
                      }
                    : undefined
                }
                onSave={(text) => edit.mutate({ note: n, body: text })}
                onDelete={() => setDeleting(n)}
              />
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this note?"
        description={deleting ? `"${deleting.body.slice(0, 80)}${deleting.body.length > 80 ? "..." : ""}" will be removed.` : undefined}
        confirmLabel="Delete note"
        destructive
        onConfirm={() => {
          if (!deleting) return;
          const index = (q.data?.items ?? []).findIndex((x) => x.id === deleting.id);
          remove.mutate({ note: deleting, index });
        }}
      />
    </div>
  );
}

function NoteRow({ note, onSeek, onSave, onDelete }: { note: Note; onSeek?: () => void; onSave: (body: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const pending = note.id.startsWith("tmp_");
  return (
    <li className="flex gap-3 py-3.5" data-testid="note-row" aria-busy={pending || undefined}>
      {note.atSeconds !== null ? (
        onSeek ? (
          <button type="button" onClick={onSeek} className="h-fit shrink-0 rounded-md px-1.5 py-0.5 text-[13px] font-semibold tabular-nums text-link hover:bg-muted" aria-label={`Play from ${clock(note.atSeconds)}`} data-testid="note-seek">
            {clock(note.atSeconds)}
          </button>
        ) : (
          <span className="shrink-0 px-1.5 py-0.5 text-[13px] font-semibold tabular-nums text-muted-foreground">{clock(note.atSeconds)}</span>
        )
      ) : null}
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = draft.trim();
              if (t && t !== note.body) onSave(t);
              setEditing(false);
            }}
          >
            <label htmlFor={`edit-${note.id}`} className="sr-only">
              Edit note
            </label>
            <Textarea id={`edit-${note.id}`} rows={3} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={5000} />
            <div className="mt-2 flex gap-2">
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(note.body);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className={pending ? "whitespace-pre-wrap text-[14.5px] text-muted-foreground" : "whitespace-pre-wrap text-[14.5px]"}>{note.body}</p>
            {!pending ? (
              <p className="mt-1 text-[12px] text-subtle-foreground">
                <TimeAgo value={note.createdAt} />
                {note.updatedAt !== note.createdAt ? " · edited" : ""}
              </p>
            ) : null}
          </>
        )}
      </div>
      {!editing && !pending ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Note actions" size="sm" data-testid="note-menu">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-[160px]">
            <DropdownMenuItem
              onSelect={() => {
                setDraft(note.body);
                setEditing(true);
              }}
            >
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

function CourseNotes() {
  const { slug } = useClassroom();
  const list = usePagedList<Note>({ queryKey: qk.notes(slug), fetchPage: (cursor) => api().learn.notes(slug, { cursor, limit: 30 }) });
  if (list.isPending) return <Skeleton className="h-24 w-full" />;
  if (!list.items.length) return <EmptyState compact icon={<NotebookPen />} title="No notes in this course yet" description="Add notes from any lesson; they collect here." />;
  return (
    <>
      <ul className="divide-y divide-border border-y border-border">
        {list.items.map((n) => (
          <li key={n.id} className="py-3.5">
            <Link href={learnHref(slug, n.itemId)} className="text-[13px] font-semibold text-link hover:underline">
              {n.itemTitle}
              {n.atSeconds !== null ? ` · ${clock(n.atSeconds)}` : ""}
            </Link>
            <p className="mt-1 whitespace-pre-wrap text-[14.5px]">{n.body}</p>
          </li>
        ))}
      </ul>
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
    </>
  );
}
