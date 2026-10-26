"use client";

import { useState } from "react";
import { ChevronDown, ClipboardCheck, FileText, FileType2, ListChecks, PlayCircle } from "lucide-react";
import type { CurriculumItemPublic, CurriculumSectionPublic } from "@open-lms/types";
import { cn } from "@open-lms/ui";
import { clock, formatDuration } from "@/lib/duration";

function ItemIcon({ item }: { item: CurriculumItemPublic }) {
  const cls = "size-4 shrink-0 text-subtle-foreground";
  if (item.kind === "QUIZ") return <ListChecks className={cls} aria-hidden />;
  if (item.kind === "ASSIGNMENT") return <ClipboardCheck className={cls} aria-hidden />;
  if (item.lectureKind === "ARTICLE") return <FileText className={cls} aria-hidden />;
  if (item.lectureKind === "PDF") return <FileType2 className={cls} aria-hidden />;
  return <PlayCircle className={cls} aria-hidden />;
}

function kindLabel(item: CurriculumItemPublic): string {
  if (item.kind === "QUIZ") return "Quiz";
  if (item.kind === "ASSIGNMENT") return "Project";
  if (item.lectureKind === "ARTICLE") return "Article";
  if (item.lectureKind === "PDF") return "PDF";
  return "Video";
}

/** The public curriculum: sections that open and close, item counts and lengths, previews. */
export function Curriculum({ sections, onPreview }: { sections: CurriculumSectionPublic[]; onPreview: (item: CurriculumItemPublic) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(sections.slice(0, 1).map((s) => s.id)));
  const allOpen = sections.length > 0 && sections.every((s) => open.has(s.id));
  const items = sections.reduce((n, s) => n + s.items.length, 0);
  const total = sections.reduce((n, s) => n + s.durationSeconds, 0);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!sections.length) return <p className="text-[14.5px] text-muted-foreground">The curriculum is being prepared.</p>;

  return (
    <div data-testid="curriculum">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13.5px] text-muted-foreground">
          {[`${sections.length} ${sections.length === 1 ? "section" : "sections"}`, `${items} ${items === 1 ? "item" : "items"}`, total > 0 ? formatDuration(total) : null].filter(Boolean).join(" · ")}
        </p>
        <button type="button" className="text-[13.5px] font-semibold text-link hover:underline" onClick={() => setOpen(allOpen ? new Set() : new Set(sections.map((s) => s.id)))} data-testid="curriculum-expand">
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className="border-t border-border">
        {sections.map((s, si) => {
          const isOpen = open.has(s.id);
          const panelId = `section-${s.id}`;
          return (
            <div key={s.id} className="border-b border-border">
              <h3>
                <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(s.id)} className="flex w-full items-center gap-3 py-4 text-left" data-testid="curriculum-section">
                  <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">Section {si + 1}</span>
                    <span className="block font-display text-[16.5px] font-semibold leading-snug">{s.title}</span>
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                    {s.items.length} {s.items.length === 1 ? "item" : "items"}
                    {s.durationSeconds > 0 ? ` · ${formatDuration(s.durationSeconds)}` : ""}
                  </span>
                </button>
              </h3>
              {isOpen ? (
                <ul id={panelId} className="pb-3 pl-7">
                  {s.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-2 text-[14.5px]">
                      <ItemIcon item={item} />
                      <span className="sr-only">{kindLabel(item)}:</span>
                      {item.isPreview ? (
                        <button type="button" onClick={() => onPreview(item)} className="min-w-0 flex-1 truncate text-left font-medium text-link hover:underline" data-testid="curriculum-preview">
                          {item.title}
                        </button>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
                      )}
                      {item.isPreview ? <span className="shrink-0 text-[12.5px] font-semibold text-primary">Preview</span> : null}
                      {item.durationSeconds > 0 ? <span className="w-14 shrink-0 text-right text-[13px] tabular-nums text-subtle-foreground">{clock(item.durationSeconds)}</span> : <span className="w-14 shrink-0" />}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
