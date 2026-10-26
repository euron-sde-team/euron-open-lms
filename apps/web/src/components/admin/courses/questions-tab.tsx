"use client";

import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, HelpCircle, Plus, Sparkles, Trash2, X } from "lucide-react";
import { isApiError, type AdminQuestionDraft } from "@open-lms/api-client";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Input,
  Select,
  Textarea,
  Tooltip,
  cn,
  toast,
} from "@open-lms/ui";
import type { AdminCourse, AdminQuestion, QuestionKind } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { useAcademyMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DataTable, pagedTable, type Column } from "@/components/admin/shell/data-table";
import { SearchInput } from "@/components/admin/shell/filter-bar";
import { useUrlState } from "@/components/admin/shell/url-state";
import { QUESTION_KIND_LABEL, changeKind, draftToInput, emptyQuestion, formToInput, questionToForm, validateQuestion, type QuestionErrors, type QuestionForm } from "./authoring-model";
import type { CourseRights } from "./course-bits";

const KINDS: QuestionKind[] = ["SINGLE", "MULTI", "TRUE_FALSE", "SHORT_TEXT"];

export function QuestionsTab({ course, rights }: { course: AdminCourse; rights: CourseRights }) {
  const qc = useQueryClient();
  const url = useUrlState();
  const q = url.get("q");
  const tag = url.get("qtag");
  const [editing, setEditing] = useState<AdminQuestion | "new" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<AdminQuestion | null>(null);
  const meta = useAcademyMeta();
  const aiOn = !!meta.data?.ai.quizGeneration;
  const filters = { courseId: course.id, q: q || undefined, tag: tag || undefined };
  const list = usePagedList<AdminQuestion>({
    queryKey: qk.admin.list("questions", filters),
    fetchPage: (cursor) => api().authoring.questions.list(course.id, { q: filters.q, tag: filters.tag, cursor }),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.admin.list("questions") });
  const remove = useMutation({
    mutationFn: (x: AdminQuestion) => api().authoring.questions.remove(course.id, x.id),
    onSuccess: (archived) => {
      invalidate();
      toast.success({ title: archived ? "Archived. Quizzes that use it keep working." : "Question deleted." });
    },
  });

  const columns: Column<AdminQuestion>[] = [
    {
      key: "prompt",
      header: "Question",
      cell: (x) => (
        <div className="min-w-[240px]">
          <p className="line-clamp-2 font-medium">{x.prompt}</p>
          {x.tags.length ? (
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {x.tags.map((t, i) => (
                <span key={t}>
                  {i > 0 ? ", " : ""}
                  <button type="button" className="hover:text-foreground hover:underline" onClick={() => url.set({ qtag: t })}>
                    {t}
                  </button>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ),
    },
    { key: "kind", header: "Kind", hideBelow: "sm", cell: (x) => <span className="text-muted-foreground">{QUESTION_KIND_LABEL[x.kind]}</span> },
    { key: "points", header: "Points", align: "right", hideBelow: "md", cell: (x) => x.points },
    { key: "used", header: "In quizzes", align: "right", hideBelow: "md", cell: (x) => x.usedInQuizzes },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (x) =>
        rights.canEdit ? (
          <IconButton size="sm" label={`Delete question: ${x.prompt.slice(0, 40)}`} onClick={() => setDeleting(x)} data-testid="question-delete">
            <Trash2 />
          </IconButton>
        ) : null,
    },
  ];

  return (
    <div data-testid="question-bank">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={(v) => url.set({ q: v })} placeholder="Search questions" testId="questions-search" />
          {tag ? (
            <Button variant="ghost" size="sm" onClick={() => url.set({ qtag: null })} data-testid="questions-tag-clear">
              Tag: {tag} <X />
            </Button>
          ) : null}
        </div>
        {rights.canEdit ? (
          <div className="flex gap-2">
            <Tooltip content={aiOn ? "Draft questions from a lecture or pasted text" : "AI assistance is not set up on this academy. An administrator can turn it on in Settings."}>
              <span>
                <Button variant="ghost" onClick={() => setGenerating(true)} disabled={!aiOn} data-testid="questions-ai">
                  <Sparkles /> Generate with AI
                </Button>
              </span>
            </Tooltip>
            <Button variant="outline" onClick={() => setEditing("new")} data-testid="question-new">
              <Plus /> New question
            </Button>
          </div>
        ) : null}
      </div>
      <DataTable
        {...pagedTable(list)}
        columns={columns}
        rowKey={(x) => x.id}
        caption="Question bank"
        onRowClick={(x) => setEditing(x)}
        rowTestId={(x) => `question-row-${x.id}`}
        empty={{
          icon: <HelpCircle />,
          title: q || tag ? "No questions match" : "The question bank is empty",
          description: q || tag ? "Try another word or tag." : "Quizzes draw from this bank. Write questions here, then add them to a quiz.",
        }}
      />
      <QuestionDialog course={course} question={editing} readOnly={!rights.canEdit} onClose={() => setEditing(null)} onSaved={invalidate} />
      {aiOn ? <AiQuestionsDialog course={course} open={generating} onOpenChange={setGenerating} onSaved={invalidate} /> : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this question?"
        description={deleting?.usedInQuizzes ? `It is in ${deleting.usedInQuizzes} ${deleting.usedInQuizzes === 1 ? "quiz" : "quizzes"}, so it is archived instead: those quizzes keep it, and it leaves the bank.` : "It is not in any quiz, so it is deleted."}
        confirmLabel="Delete question"
        destructive
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting);
        }}
      />
    </div>
  );
}

// ─── Editor ─────────────────────────────────────────────────────────────────

function QuestionDialog({ course, question, readOnly, onClose, onSaved }: { course: AdminCourse; question: AdminQuestion | "new" | null; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<QuestionForm>(emptyQuestion());
  const [errors, setErrors] = useState<QuestionErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  useEffect(() => {
    if (!question) return;
    setForm(question === "new" ? emptyQuestion() : questionToForm(question));
    setErrors({});
    setServerError(null);
  }, [question]);
  const save = useMutation({
    mutationFn: () => {
      const body = formToInput(form);
      return question && question !== "new" ? api().authoring.questions.update(course.id, question.id, body) : api().authoring.questions.create(course.id, body);
    },
    meta: { silent: true },
    onSuccess: () => {
      onSaved();
      toast.success({ title: question === "new" ? "Question added to the bank." : "Question saved." });
      onClose();
    },
    onError: (e) => setServerError(isApiError(e) && e.code === "QUESTION_INVALID" ? e.message : errorMessage(e)),
  });
  const submit = () => {
    const e = validateQuestion(form);
    setErrors(e);
    if (!Object.keys(e).length) save.mutate();
  };
  return (
    <Dialog open={!!question} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="lg" data-testid="question-dialog">
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{question === "new" ? "New question" : readOnly ? "Question" : "Edit question"}</DialogTitle>
            {question && question !== "new" && question.usedInQuizzes ? <DialogDescription>Used in {question.usedInQuizzes} {question.usedInQuizzes === 1 ? "quiz" : "quizzes"}. Attempts already taken keep the version they saw.</DialogDescription> : null}
          </DialogHeader>
          <DialogBody>
            <QuestionFields form={form} onChange={setForm} errors={errors} disabled={readOnly} />
            {serverError ? (
              <p role="alert" className="mt-3 text-[13px] font-medium text-danger">
                {serverError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly ? (
              <Button type="submit" loading={save.isPending} data-testid="question-save">
                {question === "new" ? "Add question" : "Save question"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function QuestionFields({ form, onChange, errors, disabled }: { form: QuestionForm; onChange: (f: QuestionForm) => void; errors: QuestionErrors; disabled?: boolean }) {
  const id = useId();
  const set = (p: Partial<QuestionForm>) => onChange({ ...form, ...p });
  const setOption = (i: number, p: Partial<QuestionForm["options"][number]>) => set({ options: form.options.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  const markCorrect = (i: number, on: boolean) =>
    set({ options: form.options.map((o, j) => (form.kind === "MULTI" ? (j === i ? { ...o, correct: on } : o) : { ...o, correct: j === i })) });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label="Kind" htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} value={form.kind} onValueChange={(v) => onChange(changeKind(form, v as QuestionKind))} disabled={disabled} options={KINDS.map((k) => ({ value: k, label: QUESTION_KIND_LABEL[k] }))} data-testid="question-kind" />
        </Field>
        <Field label="Points" htmlFor={`${id}-points`} error={errors.points}>
          <Input id={`${id}-points`} type="number" min={1} max={100} value={form.points} disabled={disabled} onChange={(e) => set({ points: e.target.value })} aria-invalid={!!errors.points || undefined} data-testid="question-points" />
        </Field>
      </div>
      <Field label="Question" htmlFor={`${id}-prompt`} error={errors.prompt}>
        <Textarea id={`${id}-prompt`} rows={3} maxLength={5000} value={form.prompt} disabled={disabled} onChange={(e) => set({ prompt: e.target.value })} aria-invalid={!!errors.prompt || undefined} data-testid="question-prompt" />
      </Field>

      {form.kind === "SHORT_TEXT" ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Accepted answers</legend>
          <ul className="space-y-2">
            {form.acceptedAnswers.map((a, i) => (
              <li key={i} className="flex gap-2">
                <Input aria-label={`Accepted answer ${i + 1}`} value={a} maxLength={200} disabled={disabled} onChange={(e) => set({ acceptedAnswers: form.acceptedAnswers.map((x, j) => (j === i ? e.target.value : x)) })} data-testid={`answer-${i}`} />
                {!disabled && form.acceptedAnswers.length > 1 ? (
                  <IconButton size="sm" label={`Remove answer ${i + 1}`} onClick={() => set({ acceptedAnswers: form.acceptedAnswers.filter((_, j) => j !== i) })}>
                    <X />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ul>
          {!disabled && form.acceptedAnswers.length < 10 ? (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ acceptedAnswers: [...form.acceptedAnswers, ""] })} data-testid="answer-add">
              <Plus /> Add answer
            </Button>
          ) : null}
          {errors.acceptedAnswers ? <p className="mt-1 text-xs font-medium text-danger">{errors.acceptedAnswers}</p> : null}
          <Field label="Matching" htmlFor={`${id}-match`} className="mt-3" hint={form.matchMode === "REGEX" ? "Each answer is a pattern matched against the whole reply, ignoring case." : undefined}>
            <Select
              id={`${id}-match`}
              value={form.matchMode}
              onValueChange={(v) => set({ matchMode: v as QuestionForm["matchMode"] })}
              disabled={disabled}
              options={[
                { value: "CASE_INSENSITIVE", label: "Ignore case" },
                { value: "EXACT", label: "Exact" },
                { value: "REGEX", label: "Pattern (regular expression)" },
              ]}
              data-testid="question-match"
            />
          </Field>
        </fieldset>
      ) : (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{form.kind === "MULTI" ? "Options (mark every correct one)" : "Options (mark the correct one)"}</legend>
          <ul className="divide-y divide-border border-y border-border">
            {form.options.map((o, i) => (
              <li key={i} className="flex items-center gap-2 py-2">
                {form.kind === "MULTI" ? (
                  <Checkbox aria-label={`Option ${i + 1} is correct`} checked={o.correct} disabled={disabled} onCheckedChange={(v) => markCorrect(i, !!v)} data-testid={`option-correct-${i}`} />
                ) : (
                  <input
                    type="radio"
                    name={`${id}-correct`}
                    aria-label={`Option ${i + 1} is the correct answer`}
                    checked={o.correct}
                    disabled={disabled}
                    onChange={() => markCorrect(i, true)}
                    className="size-4 accent-primary"
                    data-testid={`option-correct-${i}`}
                  />
                )}
                {form.kind === "TRUE_FALSE" ? (
                  <span className="flex-1 text-sm">{o.text}</span>
                ) : (
                  <Input aria-label={`Option ${i + 1}`} value={o.text} maxLength={500} disabled={disabled} onChange={(e) => setOption(i, { text: e.target.value })} className="h-9" data-testid={`option-text-${i}`} />
                )}
                {o.correct ? <CircleCheck className="size-4 shrink-0 text-success" aria-label="Correct" /> : <span className="size-4 shrink-0" />}
                {!disabled && form.kind !== "TRUE_FALSE" && form.options.length > 2 ? (
                  <IconButton size="sm" label={`Remove option ${i + 1}`} onClick={() => set({ options: form.options.filter((_, j) => j !== i) })}>
                    <X />
                  </IconButton>
                ) : null}
              </li>
            ))}
          </ul>
          {!disabled && form.kind !== "TRUE_FALSE" && form.options.length < 8 ? (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ options: [...form.options, { text: "", correct: false }] })} data-testid="option-add">
              <Plus /> Add option
            </Button>
          ) : null}
          {errors.options ? <p className="mt-1 text-xs font-medium text-danger">{errors.options}</p> : null}
          {errors.correct ? <p className="mt-1 text-xs font-medium text-danger">{errors.correct}</p> : null}
        </fieldset>
      )}

      <Field label="Explanation" htmlFor={`${id}-expl`} optional hint="Shown with the answer when the quiz reveals answers.">
        <Textarea id={`${id}-expl`} rows={2} maxLength={5000} value={form.explanation} disabled={disabled} onChange={(e) => set({ explanation: e.target.value })} data-testid="question-explanation" />
      </Field>
      <Field label="Tags" htmlFor={`${id}-tags`} optional hint="Comma separated. Random quizzes can draw by tag.">
        <Input id={`${id}-tags`} value={form.tags} disabled={disabled} onChange={(e) => set({ tags: e.target.value })} data-testid="question-tags" />
      </Field>
    </div>
  );
}

// ─── AI drafts ──────────────────────────────────────────────────────────────

type Draft = { key: number; draft: AdminQuestionDraft; state: "pending" | "saving" | "saved" | "skipped"; error?: string };

function AiQuestionsDialog({ course, open, onOpenChange, onSaved }: { course: AdminCourse; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const id = useId();
  const [source, setSource] = useState<"item" | "text">("item");
  const lectures = course.sections.flatMap((s) => s.items.filter((i) => i.kind === "LECTURE" && i.lectureKind !== "PDF").map((i) => ({ ...i, section: s.title })));
  const [itemId, setItemId] = useState<string>("");
  const [text, setText] = useState("");
  const [count, setCount] = useState("5");
  const [kinds, setKinds] = useState<QuestionKind[]>(["SINGLE", "MULTI", "TRUE_FALSE"]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  useEffect(() => {
    if (open) setDrafts([]);
  }, [open]);

  const n = Number(count);
  const ready = kinds.length > 0 && Number.isInteger(n) && n >= 1 && n <= 20 && (source === "item" ? !!itemId : text.trim().length >= 40);
  const generate = useMutation({
    mutationFn: () => api().authoring.ai.draftQuestions(course.id, { ...(source === "item" ? { itemId } : { sourceText: text.trim() }), count: n, kinds }),
    onSuccess: (r) => {
      setDrafts(r.drafts.map((draft, key) => ({ key, draft, state: "pending" })));
      if (!r.drafts.length) toast.info({ title: "No drafts came back. Try a longer source or other kinds." });
    },
  });

  const accept = async (d: Draft) => {
    setDrafts((list) => list.map((x) => (x.key === d.key ? { ...x, state: "saving", error: undefined } : x)));
    try {
      await api().authoring.questions.create(course.id, draftToInput(d.draft));
      setDrafts((list) => list.map((x) => (x.key === d.key ? { ...x, state: "saved" } : x)));
      return true;
    } catch (e) {
      setDrafts((list) => list.map((x) => (x.key === d.key ? { ...x, state: "pending", error: errorMessage(e) } : x)));
      return false;
    }
  };
  const acceptAll = async () => {
    const pending = drafts.filter((d) => d.state === "pending");
    let saved = 0;
    for (const d of pending) if (await accept(d)) saved++;
    onSaved();
    toast.success({ title: `${saved} ${saved === 1 ? "question" : "questions"} added to the bank.` });
  };
  const pending = drafts.filter((d) => d.state === "pending").length;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o && drafts.some((d) => d.state === "saved") ? (onSaved(), onOpenChange(false)) : onOpenChange(o))}>
      <DialogContent size="xl" data-testid="ai-questions-dialog">
        <DialogHeader>
          <DialogTitle>Generate questions with AI</DialogTitle>
          <DialogDescription>Drafts only. Nothing reaches the bank until you accept it, and you can edit any question afterwards.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {!drafts.length ? (
            <div className="space-y-4">
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Source</legend>
                <div className="flex gap-5 text-sm">
                  {(
                    [
                      ["item", "A lecture in this course"],
                      ["text", "Text I paste"],
                    ] as const
                  ).map(([v, label]) => (
                    <label key={v} className="flex items-center gap-2">
                      <input type="radio" name={`${id}-src`} checked={source === v} onChange={() => setSource(v)} className="size-4 accent-primary" data-testid={`ai-source-${v}`} />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {source === "item" ? (
                <Field label="Lecture" htmlFor={`${id}-item`} hint={lectures.length ? "Its article body or notes are the source." : "Add an article or a video with notes first, or paste text instead."}>
                  <Select id={`${id}-item`} value={itemId || undefined} onValueChange={setItemId} placeholder="Choose a lecture" options={lectures.map((l) => ({ value: l.id, label: `${l.section}: ${l.title}` }))} disabled={!lectures.length} data-testid="ai-item" />
                </Field>
              ) : (
                <Field label="Source text" htmlFor={`${id}-text`} hint="At least a paragraph. Up to 30,000 characters.">
                  <Textarea id={`${id}-text`} rows={7} maxLength={30000} value={text} onChange={(e) => setText(e.target.value)} data-testid="ai-text" />
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                <Field label="How many" htmlFor={`${id}-count`}>
                  <Input id={`${id}-count`} type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} data-testid="ai-count" />
                </Field>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium">Kinds</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2">
                    {KINDS.map((k) => (
                      <label key={k} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={kinds.includes(k)} onCheckedChange={(v) => setKinds((cur) => (v ? [...cur, k] : cur.filter((x) => x !== k)))} data-testid={`ai-kind-${k}`} />
                        {QUESTION_KIND_LABEL[k]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </div>
          ) : (
            <ol className="divide-y divide-border border-y border-border" aria-live="polite" data-testid="ai-drafts">
              {drafts.map((d, i) => (
                <li key={d.key} className={cn("py-3", d.state === "skipped" && "opacity-50")} data-testid={`ai-draft-${i}`}>
                  <div className="flex items-start gap-3">
                    <span className="w-5 shrink-0 pt-0.5 text-right text-sm tabular-nums text-subtle-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-muted-foreground">
                        {QUESTION_KIND_LABEL[d.draft.kind]} · {d.draft.points} {d.draft.points === 1 ? "point" : "points"}
                      </p>
                      <p className="mt-0.5 font-medium">{d.draft.prompt}</p>
                      {d.draft.kind === "SHORT_TEXT" ? (
                        <p className="mt-1 text-[13.5px] text-muted-foreground">Accepts: {d.draft.acceptedAnswers.join(", ")}</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5 text-[13.5px]">
                          {d.draft.options.map((o, j) => (
                            <li key={j} className={o.correct ? "font-medium text-foreground" : "text-muted-foreground"}>
                              {o.correct ? <CircleCheck className="mr-1.5 inline size-3.5 text-success" aria-label="Correct" /> : <span className="mr-1.5 inline-block size-3.5" />}
                              {o.text}
                            </li>
                          ))}
                        </ul>
                      )}
                      {d.draft.explanation ? <p className="mt-1 text-[13px] text-muted-foreground">{d.draft.explanation}</p> : null}
                      {d.error ? (
                        <p role="alert" className="mt-1 text-xs font-medium text-danger">
                          {d.error}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {d.state === "saved" ? (
                        <span className="text-[13px] font-medium text-success">Added</span>
                      ) : d.state === "skipped" ? (
                        <Button size="sm" variant="ghost" onClick={() => setDrafts((list) => list.map((x) => (x.key === d.key ? { ...x, state: "pending" } : x)))}>
                          Undo
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" disabled={d.state === "saving"} onClick={() => setDrafts((list) => list.map((x) => (x.key === d.key ? { ...x, state: "skipped" } : x)))} data-testid="ai-draft-skip">
                            Skip
                          </Button>
                          <Button size="sm" variant="outline" loading={d.state === "saving"} onClick={() => void accept(d).then((ok) => ok && onSaved())} data-testid="ai-draft-accept">
                            Accept
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DialogBody>
        <DialogFooter>
          {!drafts.length ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => generate.mutate()} disabled={!ready} loading={generate.isPending} data-testid="ai-generate">
                <Sparkles /> Generate drafts
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setDrafts([])}>
                Start over
              </Button>
              <Button variant="ghost" onClick={() => (onSaved(), onOpenChange(false))}>
                Done
              </Button>
              <Button onClick={() => void acceptAll()} disabled={!pending} data-testid="ai-accept-all">
                Accept all {pending ? `(${pending})` : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

