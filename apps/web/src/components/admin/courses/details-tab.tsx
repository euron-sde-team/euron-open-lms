"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Sparkles, Trash2 } from "lucide-react";
import { fieldErrorsOf, isApiError, type AdminCoursePatch } from "@open-lms/api-client";
import { Button, Checkbox, Field, Input, Popover, PopoverContent, PopoverTrigger, Select, Switch, Tooltip, toast } from "@open-lms/ui";
import { COURSE_LEVELS, type AdminCourse, type Category } from "@open-lms/types";
import { api } from "@/lib/api";
import { levelLabel, languageName } from "@/lib/duration";
import { errorMessage } from "@/lib/errors";
import { useAcademyMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { CourseCover } from "@/components/course/course-cover";
import { EditableList, FormSection, MarkdownField, useSetCourse, type CourseRights } from "./course-bits";

const schema = z.object({
  title: z.string().trim().min(3, "Use at least 3 characters.").max(120, "Keep it under 120 characters."),
  subtitle: z.string().trim().max(200, "Keep it under 200 characters."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Use at least 3 characters.")
    .max(60, "Keep it under 60 characters.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and single hyphens."),
  description: z.string().max(20000, "Keep it under 20,000 characters."),
  // Blank lines are dropped on save.
  outcomes: z.array(z.string().max(200)).max(20, "Up to 20 lines."),
  prerequisites: z.array(z.string().max(200)).max(20, "Up to 20 lines."),
  level: z.enum(COURSE_LEVELS),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Use a language code like en or pt-BR."),
  categoryIds: z.array(z.string()).max(10, "Pick up to 10 categories."),
  accessMode: z.enum(["FREE", "PAID", "SUBSCRIPTION_ONLY"]),
  includedInSubscription: z.boolean(),
  certificateEnabled: z.boolean(),
  featured: z.boolean(),
});

type Form = z.infer<typeof schema>;

const toForm = (c: AdminCourse): Form => ({
  title: c.title,
  subtitle: c.subtitle ?? "",
  slug: c.slug,
  description: c.description,
  outcomes: c.outcomes,
  prerequisites: c.prerequisites,
  level: c.level,
  language: c.language,
  categoryIds: c.categoryIds,
  accessMode: c.accessMode,
  includedInSubscription: c.includedInSubscription,
  certificateEnabled: c.certificateEnabled,
  featured: c.featured,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields that changed, and only those this viewer may send. */
export function coursePatch(base: Form, next: Form, rights: Pick<CourseRights, "canManage" | "isAdmin">): AdminCoursePatch {
  const out: AdminCoursePatch = {};
  const set = <K extends keyof Form>(k: K, v: unknown = next[k]) => {
    if (!same(base[k], next[k])) (out as Record<string, unknown>)[k] = v;
  };
  set("title", next.title.trim());
  set("subtitle", next.subtitle.trim() || null);
  set("description");
  set("outcomes", next.outcomes.map((o) => o.trim()).filter(Boolean));
  set("prerequisites", next.prerequisites.map((o) => o.trim()).filter(Boolean));
  set("level");
  set("language");
  set("categoryIds");
  if (rights.canManage) {
    set("slug", next.slug.trim().toLowerCase());
    set("accessMode");
    set("includedInSubscription");
    set("certificateEnabled");
  }
  if (rights.isAdmin) set("featured");
  return out;
}

export function DetailsTab({ course, rights }: { course: AdminCourse; rights: CourseRights }) {
  const id = useId();
  const setCourse = useSetCourse(course.id);
  const meta = useAcademyMeta();
  const canPolish = !!meta.data?.ai.polish;
  const base = useRef(toForm(course));
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: base.current, mode: "onBlur" });
  const { register, control, handleSubmit, formState, reset, setValue, watch, setError } = form;

  // A server change (another tab, the publish panel) refreshes the form when nothing is being edited.
  useEffect(() => {
    const next = toForm(course);
    if (!formState.isDirty && !same(next, base.current)) {
      base.current = next;
      reset(next);
    }
  }, [course, formState.isDirty, reset]);

  const save = useMutation({
    mutationFn: (patch: AdminCoursePatch) => api().authoring.courses.update(course.id, patch),
    meta: { silent: true },
    onSuccess: (c) => {
      setCourse(c);
      base.current = toForm(c);
      reset(base.current);
      toast.success({ title: "Saved." });
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") {
        for (const [k, msg] of Object.entries(fieldErrorsOf(e.details))) setError(k as keyof Form, { message: msg });
      } else if (isApiError(e) && e.code === "SLUG_TAKEN") setError("slug", { message: "Another course uses this address." });
      else if (isApiError(e) && e.code === "INVALID_SLUG") setError("slug", { message: "Use lowercase letters, digits and single hyphens." });
      toast.error({ title: errorMessage(e) });
    },
  });

  const onSubmit = handleSubmit((values) => {
    const patch = coursePatch(base.current, values, rights);
    if (!Object.keys(patch).length) return reset(values);
    save.mutate(patch);
  });

  const disabled = !rights.canEdit;
  const access = watch("accessMode");
  const e = formState.errors;

  return (
    <form onSubmit={onSubmit} className="max-w-[760px]" data-testid="course-details" noValidate>
      <FormSection title="Basics" description="How the course is named and found.">
        <div className="space-y-4">
          <Field label="Title" htmlFor={`${id}-title`} error={e.title?.message}>
            <Input id={`${id}-title`} disabled={disabled} maxLength={120} aria-invalid={!!e.title || undefined} {...register("title")} data-testid="course-title" />
          </Field>
          <Field label="Subtitle" htmlFor={`${id}-subtitle`} optional error={e.subtitle?.message} hint="One sentence under the title on the course page.">
            <div className="flex gap-2">
              <Input id={`${id}-subtitle`} disabled={disabled} maxLength={200} {...register("subtitle")} data-testid="course-subtitle" />
              {canPolish && !disabled ? <PolishButton courseId={course.id} field="subtitle" text={watch("subtitle")} onText={(t) => setValue("subtitle", t, { shouldDirty: true })} /> : null}
            </div>
          </Field>
          <Field label="Address" htmlFor={`${id}-slug`} error={e.slug?.message} hint={rights.canManage ? `The course page lives at /courses/${watch("slug") || "..."}` : rights.manageReason}>
            <Input id={`${id}-slug`} disabled={disabled || !rights.canManage} maxLength={60} aria-invalid={!!e.slug || undefined} {...register("slug")} data-testid="course-slug" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Level" htmlFor={`${id}-level`}>
              <Controller
                control={control}
                name="level"
                render={({ field }) => <Select id={`${id}-level`} value={field.value} onValueChange={field.onChange} disabled={disabled} options={COURSE_LEVELS.map((l) => ({ value: l, label: levelLabel(l) }))} data-testid="course-level" />}
              />
            </Field>
            <Field label="Language" htmlFor={`${id}-language`} error={e.language?.message} hint={e.language ? undefined : languageName(watch("language"))}>
              <Input id={`${id}-language`} disabled={disabled} maxLength={6} {...register("language")} data-testid="course-language" />
            </Field>
          </div>
          <Controller control={control} name="categoryIds" render={({ field }) => <CategoryPicker value={field.value} onChange={field.onChange} disabled={disabled} error={e.categoryIds?.message} />} />
        </div>
      </FormSection>

      <FormSection title="Cover" description="A 16:9 image. Without one, the course gets a generated cover.">
        <CoverUpload course={course} disabled={disabled} />
      </FormSection>

      <FormSection title="Description" description="What the course covers, for the course page.">
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <MarkdownField
              id={`${id}-description`}
              value={field.value}
              onChange={field.onChange}
              rows={12}
              maxLength={20000}
              disabled={disabled}
              invalid={!!e.description}
              testId="course-description"
              toolbar={canPolish && !disabled ? <PolishButton courseId={course.id} field="description" text={field.value} onText={(t) => setValue("description", t, { shouldDirty: true })} label="Polish" /> : null}
            />
          )}
        />
        {e.description ? <p className="mt-1 text-xs font-medium text-danger">{e.description.message}</p> : null}
      </FormSection>

      <FormSection title="What learners get" description="Short lines, shown as checks on the course page.">
        <div className="space-y-6">
          <Controller
            control={control}
            name="outcomes"
            render={({ field }) => (
              <EditableList
                label="Outcomes"
                values={field.value}
                onChange={field.onChange}
                placeholder="Build and deploy a small web app"
                disabled={disabled}
                testId="course-outcomes"
                trailing={
                  canPolish && !disabled
                    ? (i) => <PolishButton compact courseId={course.id} field="outcome" text={field.value[i] ?? ""} onText={(t) => field.onChange(field.value.map((v, j) => (j === i ? t : v)))} />
                    : undefined
                }
              />
            )}
          />
          <Controller
            control={control}
            name="prerequisites"
            render={({ field }) => <EditableList label="Prerequisites" values={field.value} onChange={field.onChange} placeholder="Comfortable with basic JavaScript" disabled={disabled} testId="course-prerequisites" />}
          />
        </div>
      </FormSection>

      <FormSection title="Access" description={rights.canManage ? "Who can take the course and what they get at the end." : rights.manageReason}>
        <div className="space-y-4">
          <Field label="Access" htmlFor={`${id}-access`} hint={access === "PAID" ? "Learners buy it; set prices on the Pricing tab." : access === "SUBSCRIPTION_ONLY" ? "Only subscribers can take it." : "Anyone signed in can enroll."}>
            <Controller
              control={control}
              name="accessMode"
              render={({ field }) => (
                <Select
                  id={`${id}-access`}
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    if (v === "SUBSCRIPTION_ONLY") setValue("includedInSubscription", true, { shouldDirty: true });
                  }}
                  disabled={disabled || !rights.canManage}
                  options={[
                    { value: "FREE", label: "Free" },
                    { value: "PAID", label: "Paid" },
                    { value: "SUBSCRIPTION_ONLY", label: "Subscription only" },
                  ]}
                  data-testid="course-access"
                />
              )}
            />
          </Field>
          <ToggleRow
            control={control}
            name="includedInSubscription"
            label="Included in subscription"
            hint={access === "SUBSCRIPTION_ONLY" ? "Always on for subscription-only courses." : "Subscribers can take it without buying it."}
            disabled={disabled || !rights.canManage || access === "SUBSCRIPTION_ONLY"}
          />
          <ToggleRow control={control} name="certificateEnabled" label="Certificate on completion" hint="Learners who finish get a verifiable certificate." disabled={disabled || !rights.canManage} />
          {rights.isAdmin ? <ToggleRow control={control} name="featured" label="Featured" hint="Shown first on the home page and in the catalog." disabled={disabled} /> : null}
        </div>
      </FormSection>

      {!disabled ? (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0" data-testid="details-save-bar">
          {formState.isDirty ? <span className="mr-auto text-[13px] text-muted-foreground">Unsaved changes</span> : null}
          <Button variant="ghost" disabled={!formState.isDirty || save.isPending} onClick={() => reset(base.current)}>
            Discard
          </Button>
          <Button type="submit" variant={formState.isDirty ? "primary" : "outline"} disabled={!formState.isDirty} loading={save.isPending} data-testid="course-save">
            Save changes
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function ToggleRow({ control, name, label, hint, disabled }: { control: ReturnType<typeof useForm<Form>>["control"]; name: "includedInSubscription" | "certificateEnabled" | "featured"; label: string; hint: string; disabled?: boolean }) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="flex items-start justify-between gap-4">
          <div>
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <p className="text-xs text-subtle-foreground">{hint}</p>
          </div>
          <Switch id={id} checked={field.value} onCheckedChange={field.onChange} disabled={disabled} data-testid={`course-${name}`} />
        </div>
      )}
    />
  );
}

function PolishButton({ courseId, field, text, onText, label, compact }: { courseId: string; field: "description" | "subtitle" | "outcome"; text: string; onText: (t: string) => void; label?: string; compact?: boolean }) {
  const polish = useMutation({
    mutationFn: () => api().authoring.ai.polish(courseId, { field, text: text.trim() }),
    onSuccess: (r) => {
      const before = text;
      onText(r.text);
      toast.success({ title: "Polished. Review it, then save.", action: { label: "Undo", onClick: () => onText(before) } });
    },
  });
  const empty = !text.trim();
  const btn = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => polish.mutate()}
      loading={polish.isPending}
      disabled={empty}
      aria-label={`Polish the ${field} with AI`}
      className={compact ? "px-2" : undefined}
      data-testid={`polish-${field}`}
    >
      <Sparkles />
      {compact ? null : (label ?? "Polish")}
    </Button>
  );
  return <Tooltip content={empty ? "Write something first" : "Rewrite with AI for clarity; you review before saving"}>{btn}</Tooltip>;
}

function CategoryPicker({ value, onChange, disabled, error }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; error?: string }) {
  const id = useId();
  const cats = useQuery({ queryKey: qk.admin.list("categories"), queryFn: () => api().authoring.categories.list(), staleTime: 60_000 });
  const byId = new Map((cats.data ?? []).map((c: Category) => [c.id, c]));
  const names = value.map((v) => byId.get(v)?.name).filter(Boolean);
  return (
    <div>
      <p id={`${id}-label`} className="mb-1.5 text-sm font-medium">
        Categories
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-labelledby={`${id}-label`}
            className="flex min-h-10 w-full items-center rounded-md border border-input bg-card px-3 py-2 text-left text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
            data-testid="course-categories"
          >
            {names.length ? names.join(", ") : <span className="text-subtle-foreground">Choose categories</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-sm p-1">
          {cats.isPending ? (
            <p className="p-3 text-sm text-muted-foreground">Loading categories</p>
          ) : !cats.data?.length ? (
            <p className="p-3 text-sm text-muted-foreground">No categories yet. An administrator adds them under Categories.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto" aria-label="Categories">
              {cats.data.map((c) => {
                const checked = value.includes(c.id);
                return (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm hover:bg-muted">
                      <Checkbox checked={checked} onCheckedChange={(on) => onChange(on ? [...value, c.id] : value.filter((v) => v !== c.id))} data-testid={`category-option-${c.slug}`} />
                      {c.name}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      {error ? <p className="mt-1 text-xs font-medium text-danger">{error}</p> : <p className="mt-1 text-xs text-subtle-foreground">Up to 10. The first one sets the generated cover colours.</p>}
    </div>
  );
}

function CoverUpload({ course, disabled }: { course: AdminCourse; disabled: boolean }) {
  const qc = useQueryClient();
  const setCourse = useSetCourse(course.id);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (coverUploadId: string | null) => api().authoring.courses.update(course.id, { coverUploadId }),
    onSuccess: (c) => {
      setCourse(c);
      void qc.invalidateQueries({ queryKey: qk.admin.list("courses") });
    },
    onSettled: () => {
      setProgress(null);
      setLocal(null);
    },
  });
  const pick = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error({ title: "Choose an image file (JPEG, PNG or WebP)." });
    setLocal(URL.createObjectURL(file));
    setProgress(0);
    try {
      const media = await api().media.upload({ purpose: "COURSE_COVER", file, onProgress: (f) => setProgress(f) });
      save.mutate(media.id);
    } catch (e) {
      setProgress(null);
      setLocal(null);
      toast.error({ title: errorMessage(e) });
    }
  };
  const busy = progress !== null || save.isPending;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="w-full max-w-sm">
        <CourseCover src={local ?? course.cover?.url ?? null} title={course.title} seed={course.slug} rounded="all" />
      </div>
      {!disabled ? (
        <div className="flex flex-col gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label="Upload a cover image"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pick(f);
            }}
            data-testid="cover-input"
          />
          <Button variant="outline" onClick={() => input.current?.click()} loading={busy} data-testid="cover-upload">
            <ImagePlus /> {course.cover ? "Replace cover" : "Upload cover"}
          </Button>
          {progress !== null ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Uploading {Math.round(progress * 100)}%
            </p>
          ) : null}
          {course.cover && !busy ? (
            <Button variant="ghost" size="sm" onClick={() => save.mutate(null)} data-testid="cover-remove">
              <Trash2 /> Remove
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

