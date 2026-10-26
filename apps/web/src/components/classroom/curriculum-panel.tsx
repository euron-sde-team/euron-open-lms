"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, ChevronDown, ClipboardList, FileText, ListChecks, Lock, PlayCircle, File as FileIcon } from "lucide-react";
import type { Classroom, ClassroomItem } from "@open-lms/types";
import { cn } from "@open-lms/ui";
import { ProgressRing } from "@/components/course/progress-line";
import { api } from "@/lib/api";
import { canOpen, itemKindLabel, itemStatusLabel, patchItem, ringPercent } from "@/lib/classroom/curriculum";
import { formatDuration } from "@/lib/duration";
import { qk } from "@/lib/query-keys";
import { learnHref, useClassroom } from "./classroom-context";

export function KindIcon({ item, className }: { item: Pick<ClassroomItem, "kind" | "lectureKind">; className?: string }) {
  const Icon = item.kind === "QUIZ" ? ListChecks : item.kind === "ASSIGNMENT" ? ClipboardList : item.lectureKind === "ARTICLE" ? FileText : item.lectureKind === "PDF" ? FileIcon : PlayCircle;
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden />;
}

/** Bookmarks flip instantly in the classroom cache and roll back on failure. */
export function useBookmark(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, on }: { itemId: string; on: boolean }) => (on ? api().learn.bookmark(itemId) : api().learn.unbookmark(itemId)),
    onMutate: async ({ itemId, on }) => {
      await qc.cancelQueries({ queryKey: qk.classroom(slug) });
      const prev = qc.getQueryData<Classroom>(qk.classroom(slug));
      qc.setQueryData<Classroom>(qk.classroom(slug), (c) => (c ? patchItem(c, itemId, (i) => ({ ...i, bookmarked: on })) : c));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.classroom(slug), ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.myBookmarks }),
  });
}

/** The curriculum in its own scroll area: sections fold, the open item is marked and scrolled into view. */
export function CurriculumPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { slug, classroom, itemId } = useClassroom();
  const currentSection = classroom.sections.find((s) => s.items.some((i) => i.id === itemId))?.id;
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(classroom.sections.map((s, i) => [s.id, s.id === currentSection || (!currentSection && i === 0)])));
  const bookmark = useBookmark(slug);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Opening another item unfolds its section.
  useEffect(() => {
    if (currentSection) setOpen((o) => (o[currentSection] ? o : { ...o, [currentSection]: true }));
  }, [currentSection]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [itemId]);

  return (
    <nav aria-label="Course content" data-testid="classroom-curriculum">
      <div className="px-4 pb-2 pt-4">
        <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em]">Course content</h2>
        {classroom.role === "STAFF" ? <p className="mt-1 text-[12.5px] text-muted-foreground">Staff view: progress is not recorded.</p> : null}
        {classroom.role === "PREVIEW" ? <p className="mt-1 text-[12.5px] text-muted-foreground">Preview: enroll to open every lesson.</p> : null}
      </div>
      {classroom.sections.map((section, si) => {
        const isOpen = !!open[section.id];
        const duration = section.items.reduce((n, i) => n + i.durationSeconds, 0);
        return (
          <section key={section.id} className="border-t border-border">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`sec-${section.id}`}
              onClick={() => setOpen((o) => ({ ...o, [section.id]: !isOpen }))}
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60"
              data-testid="curriculum-section"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold leading-snug">
                  {si + 1}. {section.title}
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground tabular-nums">
                  {section.completedCount} of {section.items.length}
                  {duration > 0 ? ` · ${formatDuration(duration)}` : ""}
                </p>
              </div>
              <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
            </button>
            {isOpen ? (
              <ul id={`sec-${section.id}`} className="pb-2">
                {section.items.map((item) => {
                  const active = item.id === itemId;
                  const openable = canOpen(classroom.role, item);
                  const status = itemStatusLabel(item);
                  const meta = [itemKindLabel(item), item.durationSeconds > 0 ? formatDuration(item.durationSeconds) : null, status].filter(Boolean).join(" · ");
                  return (
                    <li key={item.id} className="group/row relative">
                      {openable ? (
                        <Link
                          ref={active ? activeRef : undefined}
                          href={learnHref(slug, item.id)}
                          onClick={onNavigate}
                          aria-current={active ? "page" : undefined}
                          className={cn("flex items-start gap-3 py-2.5 pl-4 pr-12 transition-colors", active ? "bg-primary/10" : "hover:bg-muted/60")}
                          data-testid="curriculum-item"
                        >
                          {active ? <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-brand" /> : null}
                          <ProgressRing percent={ringPercent(item)} className="mt-0.5" />
                          <span className="min-w-0 flex-1">
                            <span className={cn("block text-[13.5px] leading-snug", active ? "font-semibold text-foreground" : "text-foreground")}>{item.title}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                              <KindIcon item={item} className="size-3.5" />
                              {meta}
                            </span>
                          </span>
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 py-2.5 pl-4 pr-12 text-muted-foreground" aria-disabled>
                          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] leading-snug">{item.title}</span>
                            <span className="mt-0.5 block text-[12px]">{meta}</span>
                          </span>
                        </div>
                      )}
                      {openable && classroom.role !== "PREVIEW" ? (
                        <button
                          type="button"
                          onClick={() => bookmark.mutate({ itemId: item.id, on: !item.bookmarked })}
                          aria-pressed={item.bookmarked}
                          aria-label={item.bookmarked ? `Remove bookmark: ${item.title}` : `Bookmark: ${item.title}`}
                          title={item.bookmarked ? "Remove bookmark" : "Bookmark"}
                          className={cn(
                            "absolute right-3 top-2 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100",
                            item.bookmarked ? "opacity-100" : "opacity-100 lg:opacity-0 lg:group-hover/row:opacity-100",
                          )}
                          data-testid="curriculum-bookmark"
                        >
                          <Bookmark className={cn("size-4", item.bookmarked && "fill-current text-primary")} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </nav>
  );
}
