"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, FileUp, Library, Link2, Plus, Trash2, X } from "lucide-react";
import { collectPages, isApiError } from "@open-lms/api-client";
import { Button, Checkbox, Field, IconButton, Input, Select, Switch, Textarea, cn, toast } from "@open-lms/ui";
import type { AdminCourse, AdminItem, AdminQuestion, VideoProvider } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DetailSection, DetailSheet } from "@/components/admin/shell/detail-sheet";
import { MarkdownField, VideoStatusText, courseKey, itemKindLabel, itemKey, useSetCourse, type CourseRights } from "./course-bits";
import { MarkdownPreview } from "./markdown-preview";
import { QUESTION_KIND_LABEL, rubricTotal } from "./authoring-model";
import { EvsPicker } from "./evs-picker";
import { hasErrors, itemPatch, itemToForm, validateItemForm, type ItemForm, type ItemFormErrors } from "./item-form";

const PROVIDERS: { value: VideoProvider; label: string; help: string; placeholder: string }[] = [
  { value: "EVS", label: "Video service (EVS)", help: "The id of a video on your video service.", placeholder: "Video id" },
  { value: "HLS", label: "HLS stream URL", help: "An https link to an .m3u8 playlist.", placeholder: "https://.../master.m3u8" },
  { value: "MP4", label: "MP4 file URL", help: "An https link to an .mp4 file.", placeholder: "https://.../lesson.mp4" },
  { value: "YOUTUBE", label: "YouTube", help: "A YouTube link or the 11-character video id.", placeholder: "https://www.youtube.com/watch?v=..." },
];

export function ItemEditorSheet({ course, rights, itemId, onClose }: { course: AdminCourse; rights: CourseRights; itemId: string | null; onClose: () => void }) {
  const item = useQuery({
    queryKey: itemKey(course.id, itemId ?? ""),
    queryFn: () => api().authoring.items.get(course.id, itemId!),
    enabled: !!itemId,
  });
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const close = () => (dirty ? setConfirmClose(true) : onClose());
  const data = item.data && item.data.id === itemId ? item.data : null;
  return (
    <>
      <DetailSheet
        open={!!itemId}
        onOpenChange={(o) => !o && close()}
        title={data?.title ?? ""}
        description={data ? itemKindLabel(data.kind, data.kind === "LECTURE" ? data.lecture.lectureKind : null) : undefined}
        loading={item.isPending && !data}
        error={item.error}
        onRetry={() => void item.refetch()}
        width="max-w-2xl"
        testId="item-editor"
      >
        {data ? <ItemEditorForm key={data.id} course={course} rights={rights} item={data} onDirty={setDirty} onDeleted={onClose} /> : null}
      </DetailSheet>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard your changes?"
        description="You have edits on this item that are not saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setDirty(false);
          onClose();
        }}
      />
    </>
  );
}

function ItemEditorForm({ course, rights, item, onDirty, onDeleted }: { course: AdminCourse; rights: CourseRights; item: AdminItem; onDirty: (d: boolean) => void; onDeleted: () => void }) {
  const id = useId();
  const qc = useQueryClient();
  const setCourse = useSetCourse(course.id);
  const base = useRef(itemToForm(item));
  const [form, setForm] = useState<ItemForm>(base.current);
  const [errors, setErrors] = useState<ItemFormErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const disabled = !rights.canEdit;
  const dirty = JSON.stringify(form) !== JSON.stringify(base.current);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  // Server changes (an upload, a resource) refresh the form when nothing is being edited.
  useEffect(() => {
    const next = itemToForm(item);
    if (!dirty && JSON.stringify(next) !== JSON.stringify(base.current)) {
      base.current = next;
      setForm(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const applyItem = (next: AdminItem) => {
    qc.setQueryData(itemKey(course.id, next.id), next);
    void qc.invalidateQueries({ queryKey: courseKey(course.id) });
  };
  const save = useMutation({
    mutationFn: async () => {
      const { patch, questionIds } = itemPatch(base.current, form);
      let next = item;
      if (Object.keys(patch).length) next = await api().authoring.items.update(course.id, item.id, patch);
      if (questionIds) next = await api().authoring.items.setQuestions(course.id, item.id, questionIds);
      return next;
    },
    meta: { silent: true },
    onSuccess: (next) => {
      base.current = itemToForm(next);
      setForm(base.current);
      applyItem(next);
      toast.success({ title: "Saved." });
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "INVALID_VIDEO_REF") setErrors({ videoRef: errorMessage(e) });
      toast.error({ title: errorMessage(e) });
    },
  });
  const remove = useMutation({
    mutationFn: () => api().authoring.items.remove(course.id, item.id),
    onSuccess: () => {
      setCourse((c) => ({ ...c, sections: c.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== item.id) })) }));
      void qc.invalidateQueries({ queryKey: courseKey(course.id) });
      toast.success({ title: `Deleted "${item.title}".` });
      onDeleted();
    },
  });

  const submit = () => {
    const e = validateItemForm(form);
    setErrors(e);
    if (!hasErrors(e)) save.mutate();
  };
  const set = (p: Partial<ItemForm>) => setForm((f) => ({ ...f, ...p }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <DetailSection title="Basics">
        <div className="space-y-4">
          <Field label="Title" htmlFor={`${id}-title`} error={errors.title}>
            <Input id={`${id}-title`} value={form.title} maxLength={200} disabled={disabled} onChange={(e) => set({ title: e.target.value })} data-testid="item-title" />
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Duration</legend>
              <div className="flex items-center gap-2">
                <Input aria-label="Minutes" type="number" min={0} className="w-20" value={form.minutes} disabled={disabled} onChange={(e) => set({ minutes: e.target.value })} data-testid="item-minutes" />
                <span className="text-sm text-muted-foreground">min</span>
                <Input aria-label="Seconds" type="number" min={0} max={59} className="w-20" value={form.seconds} disabled={disabled} onChange={(e) => set({ seconds: e.target.value })} data-testid="item-seconds" />
                <span className="text-sm text-muted-foreground">s</span>
              </div>
              {errors.duration ? <p className="text-xs font-medium text-danger">{errors.duration}</p> : null}
            </fieldset>
            {item.kind === "LECTURE" ? (
              <label className="flex items-center gap-3 pb-2 text-sm">
                <Switch checked={form.isPreview} onCheckedChange={(v) => set({ isPreview: v })} disabled={disabled} data-testid="item-preview" />
                Free preview
                <span className="text-xs text-subtle-foreground">Anyone can watch it from the course page.</span>
              </label>
            ) : null}
          </div>
        </div>
      </DetailSection>

      {item.kind === "LECTURE" && form.lecture ? <LectureFields course={course} item={item} form={form} set={set} errors={errors} disabled={disabled} onItem={applyItem} /> : null}
      {item.kind === "QUIZ" && form.quiz ? <QuizFields course={course} form={form} set={set} errors={errors} disabled={disabled} /> : null}
      {item.kind === "ASSIGNMENT" && form.assignment ? <AssignmentFields form={form} set={set} errors={errors} disabled={disabled} /> : null}

      {!disabled ? (
        <div className="sticky bottom-0 z-10 -mx-5 flex items-center gap-2 border-t border-border bg-card px-5 py-3">
          <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)} data-testid="item-editor-delete">
            <Trash2 /> Delete
          </Button>
          <span className="ml-auto text-[13px] text-muted-foreground" aria-live="polite">
            {dirty ? "Unsaved changes" : ""}
          </span>
          <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => (setForm(base.current), setErrors({}))}>
            Discard
          </Button>
          <Button type="submit" disabled={!dirty} loading={save.isPending} data-testid="item-save">
            Save
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${item.title}"?`}
        description="Learner progress, attempts and submissions on it are removed too."
        confirmLabel="Delete item"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </form>
  );
}

type FieldsProps = { form: ItemForm; set: (p: Partial<ItemForm>) => void; errors: ItemFormErrors; disabled: boolean };

// ─── Lectures ───────────────────────────────────────────────────────────────

function LectureFields({ course, item, form, set, errors, disabled, onItem }: FieldsProps & { course: AdminCourse; item: Extract<AdminItem, { kind: "LECTURE" }>; onItem: (i: AdminItem) => void }) {
  const id = useId();
  const l = form.lecture!;
  const setL = (p: Partial<NonNullable<ItemForm["lecture"]>>) => set({ lecture: { ...l, ...p } });
  const evs = useQuery({ queryKey: qk.admin.area("evs-status"), queryFn: () => api().authoring.evs.status(), staleTime: 5 * 60_000, enabled: l.lectureKind === "VIDEO" });
  const [picking, setPicking] = useState(false);
  const provider = PROVIDERS.find((p) => p.value === l.videoProvider) ?? PROVIDERS[0]!;

  return (
    <>
      {l.lectureKind === "VIDEO" ? (
        <DetailSection title="Video" action={<span className="text-[13px]">Status: <VideoStatusText status={item.lecture.videoStatus} /></span>}>
          <div className="space-y-4">
            <Field label="Source" htmlFor={`${id}-provider`}>
              <Select id={`${id}-provider`} value={l.videoProvider} onValueChange={(v) => setL({ videoProvider: v as VideoProvider })} disabled={disabled} options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))} data-testid="video-provider" />
            </Field>
            <Field
              label={l.videoProvider === "EVS" ? "Video id" : "Link"}
              htmlFor={`${id}-ref`}
              error={errors.videoRef}
              hint={
                l.videoProvider === "EVS" && evs.data && !evs.data.canListVideos
                  ? evs.data.configured
                    ? "Paste the video id from your video service. Browsing the library needs a read key in the EVS settings."
                    : "The video service is not connected yet. An administrator sets it up under Settings, then paste the video id from it here."
                  : provider.help
              }
            >
              <div className="flex gap-2">
                <Input id={`${id}-ref`} value={l.videoRef} maxLength={500} placeholder={provider.placeholder} disabled={disabled} onChange={(e) => setL({ videoRef: e.target.value })} aria-invalid={!!errors.videoRef || undefined} data-testid="video-ref" />
                {l.videoProvider === "EVS" && evs.data?.canListVideos && !disabled ? (
                  <Button variant="outline" onClick={() => setPicking(true)} data-testid="evs-choose">
                    <Library /> Choose from library
                  </Button>
                ) : null}
              </div>
            </Field>
            {item.lecture.videoStatus === "FAILED" ? <p className="text-[13px] text-danger">The video service could not process this video. Upload it again there, or choose another one.</p> : null}
            {item.lecture.videoStatus === "PROCESSING" && l.videoRef ? <p className="text-[13px] text-muted-foreground">Still processing. This updates on its own when the video is ready.</p> : null}
          </div>
          <EvsPicker
            open={picking}
            onOpenChange={setPicking}
            onPick={(v) => {
              const p: Partial<ItemForm> = { lecture: { ...l, videoRef: v.id } };
              if (v.durationSeconds && Number(form.minutes) === 0 && Number(form.seconds) === 0) {
                p.minutes = String(Math.floor(v.durationSeconds / 60));
                p.seconds = String(Math.round(v.durationSeconds % 60));
              }
              if (form.title.startsWith("New ") && v.title) p.title = v.title.slice(0, 200);
              set(p);
              setPicking(false);
            }}
          />
        </DetailSection>
      ) : null}

      {l.lectureKind === "PDF" ? <PdfField course={course} item={item} disabled={disabled} onItem={onItem} /> : null}

      <DetailSection title={l.lectureKind === "ARTICLE" ? "Article" : "Notes"}>
        {l.lectureKind === "ARTICLE" ? (
          <div className="space-y-4">
            <Textarea
              aria-label="Article body in markdown"
              rows={14}
              value={l.body}
              maxLength={100000}
              disabled={disabled}
              onChange={(e) => setL({ body: e.target.value })}
              className="font-mono text-[13.5px]"
              data-testid="article-body"
            />
            <div aria-live="off">
              <p className="mb-2 text-[12.5px] font-medium text-muted-foreground">Preview</p>
              <div className="border-y border-border py-3" data-testid="article-preview">
                <MarkdownPreview source={l.body} empty="Start writing to see the article here." />
              </div>
            </div>
          </div>
        ) : (
          <MarkdownField id={`${id}-notes`} value={l.body} onChange={(v) => setL({ body: v })} rows={6} maxLength={100000} disabled={disabled} placeholder="Optional notes shown under the lecture" testId="lecture-notes" />
        )}
      </DetailSection>

      <ResourcesField course={course} item={item} disabled={disabled} onItem={onItem} />
    </>
  );
}

function useUploadThen(purpose: "LECTURE_PDF" | "LECTURE_RESOURCE") {
  const [progress, setProgress] = useState<number | null>(null);
  const run = async (file: File) => {
    setProgress(0);
    try {
      return await api().media.upload({ purpose, file, onProgress: setProgress });
    } finally {
      setProgress(null);
    }
  };
  return { progress, run };
}

function PdfField({ course, item, disabled, onItem }: { course: AdminCourse; item: Extract<AdminItem, { kind: "LECTURE" }>; disabled: boolean; onItem: (i: AdminItem) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadThen("LECTURE_PDF");
  const save = useMutation({ mutationFn: (pdfUploadId: string | null) => api().authoring.items.update(course.id, item.id, { lecture: { pdfUploadId } }), onSuccess: onItem });
  const pick = async (file: File) => {
    if (file.type && file.type !== "application/pdf") return toast.error({ title: "Choose a PDF file." });
    try {
      const media = await upload.run(file);
      save.mutate(media.id);
    } catch (e) {
      toast.error({ title: errorMessage(e) });
    }
  };
  const pdf = item.lecture.pdf;
  return (
    <DetailSection title="PDF">
      {pdf ? (
        <p className="mb-3 flex items-center gap-2 text-sm">
          <a href={pdf.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-link hover:underline">
            {pdf.fileName} <ExternalLink className="size-3.5" aria-hidden />
          </a>
          {pdf.sizeBytes ? <span className="text-muted-foreground">· {(pdf.sizeBytes / 1024 / 1024).toFixed(1)} MB</span> : null}
        </p>
      ) : (
        <p className="mb-3 text-[13.5px] text-muted-foreground">No PDF yet. Learners read it in the classroom.</p>
      )}
      {!disabled ? (
        <>
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            className="sr-only"
            aria-label="Upload a PDF"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pick(f);
            }}
            data-testid="pdf-input"
          />
          <Button variant="outline" onClick={() => input.current?.click()} loading={upload.progress !== null || save.isPending} data-testid="pdf-upload">
            <FileUp /> {pdf ? "Replace PDF" : "Upload PDF"}
          </Button>
          {upload.progress !== null ? (
            <span className="ml-3 text-xs text-muted-foreground" aria-live="polite">
              Uploading {Math.round(upload.progress * 100)}%
            </span>
          ) : null}
        </>
      ) : null}
    </DetailSection>
  );
}

function ResourcesField({ course, item, disabled, onItem }: { course: AdminCourse; item: Extract<AdminItem, { kind: "LECTURE" }>; disabled: boolean; onItem: (i: AdminItem) => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadThen("LECTURE_RESOURCE");
  const [link, setLink] = useState<{ title: string; url: string } | null>(null);
  const add = useMutation({ mutationFn: (b: { title: string; uploadId?: string; url?: string }) => api().authoring.items.addResource(course.id, item.id, b), onSuccess: (i) => (onItem(i), setLink(null)) });
  const remove = useMutation({ mutationFn: (resourceId: string) => api().authoring.items.removeResource(course.id, item.id, resourceId), onSuccess: onItem });
  const pick = async (file: File) => {
    try {
      const media = await upload.run(file);
      add.mutate({ title: file.name.slice(0, 120), uploadId: media.id });
    } catch (e) {
      toast.error({ title: errorMessage(e) });
    }
  };
  const linkOk = !!link && link.title.trim().length > 0 && /^https:\/\/\S+$/i.test(link.url.trim());
  return (
    <DetailSection title="Resources" testId="item-resources">
      {item.resources.length ? (
        <ul className="mb-3 divide-y divide-border border-y border-border">
          {item.resources.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
              {r.url ? <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <a href={r.url ?? r.upload?.url ?? "#"} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 flex-1 truncate hover:underline">
                {r.title}
              </a>
              {!disabled ? (
                <IconButton size="sm" label={`Remove ${r.title}`} onClick={() => remove.mutate(r.id)} data-testid="resource-remove">
                  <X />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-[13.5px] text-muted-foreground">Files and links learners can download with this lecture.</p>
      )}
      {!disabled ? (
        link ? (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Link title" placeholder="Title" value={link.title} maxLength={120} onChange={(e) => setLink({ ...link, title: e.target.value })} data-testid="resource-link-title" />
              <Input id={`${id}-url`} aria-label="Link URL" placeholder="https://" value={link.url} maxLength={500} onChange={(e) => setLink({ ...link, url: e.target.value })} data-testid="resource-link-url" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={!linkOk} loading={add.isPending} onClick={() => link && add.mutate({ title: link.title.trim(), url: link.url.trim() })} data-testid="resource-link-add">
                Add link
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLink(null)}>
                Cancel
              </Button>
              {link.url && !/^https:\/\//i.test(link.url) ? <span className="self-center text-xs text-danger">Use an https:// link.</span> : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              className="sr-only"
              aria-label="Upload a resource file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pick(f);
              }}
              data-testid="resource-input"
            />
            <Button size="sm" variant="outline" onClick={() => input.current?.click()} loading={upload.progress !== null || (add.isPending && !link)} data-testid="resource-file">
              <FileUp /> Add file
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLink({ title: "", url: "" })} data-testid="resource-link">
              <Link2 /> Add link
            </Button>
          </div>
        )
      ) : null}
    </DetailSection>
  );
}

// ─── Quizzes ────────────────────────────────────────────────────────────────

export function useAllQuestions(courseId: string, enabled = true) {
  return useQuery({
    queryKey: qk.admin.list("questions", { courseId, all: true }),
    queryFn: () => collectPages((cursor) => api().authoring.questions.list(courseId, { cursor, limit: 50 }), 500),
    enabled,
    staleTime: 30_000,
  });
}

function NumberField({ label, id, value, onChange, error, hint, disabled, suffix, testId, placeholder }: { label: string; id: string; value: string; onChange: (v: string) => void; error?: string; hint?: ReactNode; disabled: boolean; suffix?: string; testId?: string; placeholder?: string }) {
  return (
    <Field label={label} htmlFor={id} error={error} hint={hint}>
      <div className="flex items-center gap-2">
        <Input id={id} type="number" inputMode="numeric" min={0} className="w-28" value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error || undefined} data-testid={testId} />
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </Field>
  );
}

function QuizFields({ course, form, set, errors, disabled }: FieldsProps & { course: AdminCourse }) {
  const id = useId();
  const q = form.quiz!;
  const setQ = (p: Partial<NonNullable<ItemForm["quiz"]>>) => set({ quiz: { ...q, ...p } });
  const bank = useAllQuestions(course.id);
  const byId = useMemo(() => new Map((bank.data ?? []).map((x) => [x.id, x])), [bank.data]);
  const [adding, setAdding] = useState(false);
  const move = (i: number, d: -1 | 1) => {
    const next = q.questionIds.slice();
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setQ({ questionIds: next });
  };
  return (
    <>
      <DetailSection title="Quiz">
        <div className="space-y-4">
          <Field label="Instructions" htmlFor={`${id}-instr`} optional>
            <Textarea id={`${id}-instr`} rows={3} maxLength={5000} value={q.instructions} disabled={disabled} onChange={(e) => setQ({ instructions: e.target.value })} data-testid="quiz-instructions" />
          </Field>
          <Field label="Questions" htmlFor={`${id}-sel`} hint={q.selection === "FIXED" ? "The same questions, in this order, for everyone." : "Each attempt draws questions at random from the bank."}>
            <Select
              id={`${id}-sel`}
              value={q.selection}
              onValueChange={(v) => setQ({ selection: v as "FIXED" | "RANDOM" })}
              disabled={disabled}
              options={[
                { value: "FIXED", label: "Fixed list" },
                { value: "RANDOM", label: "Random draw" },
              ]}
              data-testid="quiz-selection"
            />
          </Field>
        </div>
      </DetailSection>

      {q.selection === "FIXED" ? (
        <DetailSection
          title={`Questions in this quiz (${q.questionIds.length})`}
          action={
            !disabled ? (
              <Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)} data-testid="quiz-add-questions">
                <Plus /> {adding ? "Done adding" : "Add from bank"}
              </Button>
            ) : null
          }
          testId="quiz-questions"
        >
          {q.questionIds.length ? (
            <ol className="divide-y divide-border border-y border-border">
              {q.questionIds.map((qid, i) => {
                const question = byId.get(qid);
                return (
                  <li key={qid} className="flex items-center gap-2 py-2 text-sm">
                    <span className="w-6 shrink-0 text-right tabular-nums text-subtle-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2">{question?.prompt ?? (bank.isPending ? "Loading" : "A question that is no longer in the bank")}</p>
                      {question ? <p className="text-[12.5px] text-muted-foreground">{QUESTION_KIND_LABEL[question.kind]} · {question.points} {question.points === 1 ? "point" : "points"}</p> : null}
                    </div>
                    {!disabled ? (
                      <>
                        <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp />
                        </IconButton>
                        <IconButton size="sm" label="Move down" disabled={i === q.questionIds.length - 1} onClick={() => move(i, 1)}>
                          <ArrowDown />
                        </IconButton>
                        <IconButton size="sm" label="Remove from quiz" onClick={() => setQ({ questionIds: q.questionIds.filter((x) => x !== qid) })}>
                          <X />
                        </IconButton>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">No questions yet. Add them from the course question bank (the Questions tab).</p>
          )}
          {adding ? <BankPicker bank={bank.data ?? []} loading={bank.isPending} selected={q.questionIds} onToggle={(qid, on) => setQ({ questionIds: on ? [...q.questionIds, qid] : q.questionIds.filter((x) => x !== qid) })} /> : null}
        </DetailSection>
      ) : (
        <DetailSection title="Random draw">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Questions per attempt" id={`${id}-draw`} value={q.drawCount} onChange={(v) => setQ({ drawCount: v })} error={errors.drawCount} disabled={disabled} testId="quiz-draw-count" />
            <Field label="Only questions tagged" htmlFor={`${id}-tags`} optional hint="Comma separated. Empty draws from the whole bank.">
              <Input id={`${id}-tags`} value={q.drawTags} disabled={disabled} onChange={(e) => setQ({ drawTags: e.target.value })} data-testid="quiz-draw-tags" />
            </Field>
          </div>
        </DetailSection>
      )}

      <DetailSection title="Rules">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField label="Pass mark" id={`${id}-pass`} value={q.passPercent} onChange={(v) => setQ({ passPercent: v })} error={errors.passPercent} disabled={disabled} suffix="%" testId="quiz-pass" />
          <NumberField label="Time limit" id={`${id}-time`} value={q.timeLimitMinutes} onChange={(v) => setQ({ timeLimitMinutes: v })} error={errors.timeLimit} disabled={disabled} suffix="min" placeholder="None" testId="quiz-time" />
          <NumberField label="Attempts" id={`${id}-attempts`} value={q.maxAttempts} onChange={(v) => setQ({ maxAttempts: v })} error={errors.maxAttempts} disabled={disabled} placeholder="Unlimited" testId="quiz-attempts" />
        </div>
        <div className="mt-4 space-y-3">
          <label className="flex items-center justify-between gap-4 text-sm">
            Shuffle question order
            <Switch checked={q.shuffleQuestions} onCheckedChange={(v) => setQ({ shuffleQuestions: v })} disabled={disabled} data-testid="quiz-shuffle-questions" />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            Shuffle answer options
            <Switch checked={q.shuffleOptions} onCheckedChange={(v) => setQ({ shuffleOptions: v })} disabled={disabled} data-testid="quiz-shuffle-options" />
          </label>
          <Field label="Show correct answers" htmlFor={`${id}-reveal`}>
            <Select
              id={`${id}-reveal`}
              value={q.reveal}
              onValueChange={(v) => setQ({ reveal: v as typeof q.reveal })}
              disabled={disabled}
              options={[
                { value: "AFTER_SUBMIT", label: "After each attempt" },
                { value: "AFTER_PASS", label: "Once the learner passes" },
                { value: "NEVER", label: "Never" },
              ]}
              data-testid="quiz-reveal"
            />
          </Field>
        </div>
      </DetailSection>
    </>
  );
}

function BankPicker({ bank, loading, selected, onToggle }: { bank: AdminQuestion[]; loading: boolean; selected: string[]; onToggle: (id: string, on: boolean) => void }) {
  const [q, setQ] = useState("");
  const shown = bank.filter((x) => !q.trim() || x.prompt.toLowerCase().includes(q.trim().toLowerCase()) || x.tags.some((t) => t.includes(q.trim().toLowerCase())));
  return (
    <div className="mt-4" data-testid="bank-picker">
      <Input aria-label="Search the question bank" placeholder="Search questions or tags" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? (
        <p className="py-3 text-sm text-muted-foreground">Loading the bank</p>
      ) : !bank.length ? (
        <p className="py-3 text-sm text-muted-foreground">The bank is empty. Write questions on the Questions tab first.</p>
      ) : (
        <ul className="mt-2 max-h-80 divide-y divide-border overflow-y-auto border-y border-border">
          {shown.map((x) => (
            <li key={x.id}>
              <label className="flex cursor-pointer items-start gap-3 py-2 text-sm">
                <Checkbox className="mt-0.5" checked={selected.includes(x.id)} onCheckedChange={(on) => onToggle(x.id, !!on)} data-testid={`bank-option-${x.id}`} />
                <span className="min-w-0">
                  <span className="line-clamp-2">{x.prompt}</span>
                  <span className="text-[12.5px] text-muted-foreground">
                    {QUESTION_KIND_LABEL[x.kind]}
                    {x.tags.length ? ` · ${x.tags.join(", ")}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {!shown.length ? <li className="py-3 text-sm text-muted-foreground">No questions match.</li> : null}
        </ul>
      )}
    </div>
  );
}

// ─── Assignments ────────────────────────────────────────────────────────────

function AssignmentFields({ form, set, errors, disabled }: FieldsProps) {
  const id = useId();
  const a = form.assignment!;
  const setA = (p: Partial<NonNullable<ItemForm["assignment"]>>) => set({ assignment: { ...a, ...p } });
  const total = rubricTotal(a.rubric);
  const setRow = (i: number, p: Partial<(typeof a.rubric)[number]>) => setA({ rubric: a.rubric.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const moveRow = (i: number, d: -1 | 1) => {
    const next = a.rubric.slice();
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setA({ rubric: next });
  };
  return (
    <>
      <DetailSection title="Instructions">
        <MarkdownField id={`${id}-instr`} value={a.instructions} onChange={(v) => setA({ instructions: v })} rows={8} maxLength={20000} disabled={disabled} placeholder="What to make and how it is judged" testId="assignment-instructions" />
      </DetailSection>

      <DetailSection title="Rubric" action={<span className="text-[13px] tabular-nums text-muted-foreground" data-testid="rubric-total">Total {total} {total === 1 ? "point" : "points"}</span>} testId="rubric-editor">
        {a.rubric.length ? (
          <ol className="divide-y divide-border border-y border-border">
            {a.rubric.map((r, i) => {
              const e = errors.rubricRows?.[i];
              return (
                <li key={r.id ?? `new-${i}`} className="grid grid-cols-[1fr_auto] gap-2 py-3" data-testid={`rubric-row-${i}`}>
                  <div className="space-y-2">
                    <Input aria-label={`Criterion ${i + 1} title`} placeholder="Criterion, like Correctness" value={r.title} maxLength={120} disabled={disabled} onChange={(ev) => setRow(i, { title: ev.target.value })} aria-invalid={!!e?.title || undefined} />
                    <Input aria-label={`Criterion ${i + 1} description`} placeholder="What earns full marks (optional)" value={r.description} maxLength={1000} disabled={disabled} onChange={(ev) => setRow(i, { description: ev.target.value })} />
                    {e?.title ? <p className="text-xs font-medium text-danger">{e.title}</p> : null}
                    {e?.maxPoints ? <p className="text-xs font-medium text-danger">{e.maxPoints}</p> : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1.5">
                      <Input aria-label={`Criterion ${i + 1} max points`} type="number" min={1} max={1000} className="w-20" value={r.maxPoints} disabled={disabled} onChange={(ev) => setRow(i, { maxPoints: ev.target.value })} aria-invalid={!!e?.maxPoints || undefined} />
                      <span className="text-xs text-muted-foreground">pts</span>
                    </div>
                    {!disabled ? (
                      <div className="flex">
                        <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => moveRow(i, -1)}>
                          <ArrowUp />
                        </IconButton>
                        <IconButton size="sm" label="Move down" disabled={i === a.rubric.length - 1} onClick={() => moveRow(i, 1)}>
                          <ArrowDown />
                        </IconButton>
                        <IconButton size="sm" label={`Remove criterion ${i + 1}`} onClick={() => setA({ rubric: a.rubric.filter((_, j) => j !== i) })}>
                          <X />
                        </IconButton>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">No criteria yet. Reviewers score each criterion; the total decides the grade.</p>
        )}
        {!disabled && a.rubric.length < 20 ? (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setA({ rubric: [...a.rubric, { title: "", description: "", maxPoints: "10" }] })} data-testid="rubric-add">
            <Plus /> Add criterion
          </Button>
        ) : null}
        <div className="mt-4">
          <NumberField label="Pass mark" id={`${id}-pass`} value={a.passPoints} onChange={(v) => setA({ passPoints: v })} error={errors.passPoints} disabled={disabled} suffix={`of ${total} points`} placeholder="None" hint="Approving below it is blocked. Empty means any score can pass." testId="assignment-pass" />
        </div>
      </DetailSection>

      <DetailSection title="Submissions">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Learners can submit</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ["acceptText", "Written answer"],
                ["acceptFiles", "Files"],
                ["acceptUrl", "A link"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox checked={a[k]} onCheckedChange={(v) => setA({ [k]: !!v } as Partial<typeof a>)} disabled={disabled} data-testid={`assignment-${k}`} />
                {label}
              </label>
            ))}
          </div>
          {errors.accept ? <p className="mt-1 text-xs font-medium text-danger">{errors.accept}</p> : null}
        </fieldset>
        <div className={cn("mt-4 grid gap-4 sm:grid-cols-2")}>
          {a.acceptFiles ? <NumberField label="Files per submission" id={`${id}-files`} value={a.maxFiles} onChange={(v) => setA({ maxFiles: v })} error={errors.maxFiles} disabled={disabled} testId="assignment-max-files" /> : null}
          <NumberField label="Due" id={`${id}-due`} value={a.dueDays} onChange={(v) => setA({ dueDays: v })} error={errors.dueDays} disabled={disabled} suffix="days after enrolling" placeholder="None" testId="assignment-due" />
        </div>
        {a.dueDays.trim() ? (
          <label className="mt-3 flex items-center justify-between gap-4 text-sm">
            Accept late submissions
            <Switch checked={a.allowLate} onCheckedChange={(v) => setA({ allowLate: v })} disabled={disabled} data-testid="assignment-allow-late" />
          </label>
        ) : null}
      </DetailSection>
    </>
  );
}
