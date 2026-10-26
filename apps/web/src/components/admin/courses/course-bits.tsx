"use client";

import { useId, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Badge, Button, IconButton, Input, Textarea, cn } from "@open-lms/ui";
import type { AccessMode, AdminCourse, CourseStatus, ItemKind, LectureKind, VideoStatus } from "@open-lms/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { AdminViewer } from "@/components/admin/shell/session";
import { MarkdownPreview } from "./markdown-preview";

// ─── Labels ─────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<CourseStatus, string> = { DRAFT: "Draft", PUBLISHED: "Published", ARCHIVED: "Archived" };
const STATUS_TONE: Record<CourseStatus, "neutral" | "success" | "warning"> = { DRAFT: "neutral", PUBLISHED: "success", ARCHIVED: "warning" };

export function CourseStatusBadge({ status }: { status: CourseStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-testid="course-status">
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export const ACCESS_LABEL: Record<AccessMode, string> = { FREE: "Free", PAID: "Paid", SUBSCRIPTION_ONLY: "Subscription only" };

export function itemKindLabel(kind: ItemKind, lectureKind: LectureKind | null): string {
  if (kind === "QUIZ") return "Quiz";
  if (kind === "ASSIGNMENT") return "Assignment";
  return lectureKind === "ARTICLE" ? "Article" : lectureKind === "PDF" ? "PDF" : "Video lecture";
}

export const VIDEO_STATUS_LABEL: Record<VideoStatus, string> = { PROCESSING: "Processing", READY: "Ready", FAILED: "Failed" };

/** Video state as words in the meta line (colour is never the only signal). */
export function VideoStatusText({ status, className }: { status: VideoStatus; className?: string }) {
  return (
    <span className={cn(status === "FAILED" ? "font-medium text-danger" : status === "PROCESSING" ? "text-warning-soft-foreground" : "text-muted-foreground", className)} data-testid="video-status">
      {VIDEO_STATUS_LABEL[status]}
    </span>
  );
}

// ─── Data ───────────────────────────────────────────────────────────────────

export const courseKey = (id: string) => qk.admin.detail("courses", id);
export const itemKey = (courseId: string, itemId: string) => [...qk.admin.detail("course-items", courseId), itemId] as const;
export const courseListKey = (f: Record<string, unknown>) => qk.admin.list("courses", f);

export function useAdminCourse(id: string) {
  return useQuery({ queryKey: courseKey(id), queryFn: () => api().authoring.courses.get(id) });
}

/** Write a course into the cache (optimistic edits and server answers). */
export function useSetCourse(id: string) {
  const qc = useQueryClient();
  return (next: AdminCourse | ((c: AdminCourse) => AdminCourse)) =>
    qc.setQueryData<AdminCourse>(courseKey(id), (cur) => (cur ? (typeof next === "function" ? next(cur) : next) : typeof next === "function" ? cur : next));
}

/** What the viewer may do on this course, and why not when they may not. */
export function courseRights(course: Pick<AdminCourse, "canManage" | "myRole">, viewer: Pick<AdminViewer, "isAdmin">) {
  const canEdit = course.canManage || course.myRole === "OWNER" || course.myRole === "EDITOR";
  const readOnlyReason = canEdit
    ? null
    : course.myRole === "GRADER"
      ? "You grade this course, so you can read it and review submissions, but only its owner or editors can change it."
      : "Your role can view this course but not change it.";
  const manageReason = course.canManage ? null : "Only the course owner or an administrator can change this.";
  return { canEdit, canManage: course.canManage, isAdmin: viewer.isAdmin, readOnlyReason, manageReason };
}

export type CourseRights = ReturnType<typeof courseRights>;

// ─── Small form pieces ──────────────────────────────────────────────────────

/** A section of a settings column: heading, one line of help, then fields. No card. */
export function FormSection({ title, description, children, actions, className, testId }: { title: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={cn("border-t border-border py-6 first:border-t-0 first:pt-0", className)} data-testid={testId}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[18px] font-semibold tracking-[-0.015em]">{title}</h2>
          {description ? <p className="mt-1 max-w-2xl text-[13.5px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A quiet note at the top of a tab that the viewer cannot change it. */
export function ReadOnlyNote({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="mb-5 border-l-2 border-warning pl-3 text-[13.5px] text-muted-foreground" data-testid="read-only-note">
      {children}
    </p>
  );
}

/** An editable list of short lines (outcomes, prerequisites): add, edit, reorder, remove. */
export function EditableList({
  label,
  values,
  onChange,
  placeholder,
  max = 20,
  disabled,
  testId,
  trailing,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  max?: number;
  disabled?: boolean;
  testId?: string;
  /** Extra per-row action (an AI polish button). */
  trailing?: (index: number) => ReactNode;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t || values.length >= max) return;
    onChange([...values, t]);
    setDraft("");
  };
  const move = (i: number, d: -1 | 1) => {
    const next = values.slice();
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
  };
  return (
    <div data-testid={testId}>
      <p id={`${id}-label`} className="mb-1.5 text-sm font-medium">
        {label}
      </p>
      {values.length ? (
        <ul aria-labelledby={`${id}-label`} className="mb-2 divide-y divide-border border-y border-border">
          {values.map((v, i) => (
            <li key={i} className="flex items-center gap-1 py-1.5">
              <Input
                aria-label={`${label} ${i + 1}`}
                value={v}
                maxLength={200}
                disabled={disabled}
                onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
                className="h-9 border-transparent bg-transparent shadow-none hover:border-input focus-visible:border-ring"
              />
              {trailing?.(i)}
              {!disabled ? (
                <>
                  <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton size="sm" label="Move down" disabled={i === values.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </IconButton>
                  <IconButton size="sm" label={`Remove "${v}"`} onClick={() => onChange(values.filter((_, j) => j !== i))}>
                    <X />
                  </IconButton>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!disabled && values.length < max ? (
        <div className="flex gap-2">
          <Input
            aria-label={`Add to ${label.toLowerCase()}`}
            value={draft}
            maxLength={200}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            data-testid={testId ? `${testId}-input` : undefined}
          />
          <Button variant="outline" onClick={add} disabled={!draft.trim()} data-testid={testId ? `${testId}-add` : undefined}>
            <Plus /> Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** A markdown textarea with "Write" and "Preview" as words above it. */
export function MarkdownField({
  id,
  value,
  onChange,
  rows = 8,
  maxLength,
  disabled,
  placeholder,
  testId,
  toolbar,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  placeholder?: string;
  testId?: string;
  toolbar?: ReactNode;
  invalid?: boolean;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Editor mode" className="flex gap-4 text-[13px]">
          {(["write", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("relative pb-1 font-medium", mode === m ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              data-testid={testId ? `${testId}-${m}` : undefined}
            >
              {m === "write" ? "Write" : "Preview"}
              <span aria-hidden className={cn("absolute inset-x-0 -bottom-px h-0.5 rounded-full", mode === m ? "bg-ink" : "bg-transparent")} />
            </button>
          ))}
        </div>
        {toolbar}
      </div>
      {mode === "write" ? (
        <Textarea
          id={id}
          rows={rows}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-[13.5px]"
          data-testid={testId}
        />
      ) : (
        <div className="min-h-[120px] border-y border-border py-3" data-testid={testId ? `${testId}-preview` : undefined}>
          <MarkdownPreview source={value} />
        </div>
      )}
      <p className="mt-1 text-xs text-subtle-foreground">Markdown: # headings, **bold**, *italic*, lists, `code` and [links](https://example.com).</p>
    </div>
  );
}

/** "3 of 10" style numbers parse helpers for number inputs. */
export const intOrNull = (raw: string): number | null => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : NaN;
};
