"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Download, FileText } from "lucide-react";
import type { ItemContent } from "@open-lms/types";
import { Button } from "@open-lms/ui";
import { api } from "@/lib/api";
import { useClassroom } from "./classroom-context";
import { useApplyProgress } from "./use-progress";

type LectureContent = Extract<ItemContent, { kind: "LECTURE" }>;

export function formatBytes(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "Mark as done" for articles and PDFs; a quiet completed line once it is. */
export function MarkDone({ content }: { content: LectureContent }) {
  const { classroom } = useClassroom();
  const apply = useApplyProgress();
  const itemId = content.item.id;
  const done = useMutation({
    mutationFn: () => api().learn.complete(itemId),
    onSuccess: (r) => apply(itemId, r),
  });
  if (classroom.role !== "LEARNER") return <p className="text-[13px] text-muted-foreground">{classroom.role === "STAFF" ? "Staff view: progress is not recorded." : "Enroll to keep your progress."}</p>;
  if (content.progress.completed || done.isSuccess) {
    return (
      <p className="flex items-center gap-2 text-[14px] font-medium text-success" role="status" data-testid="lesson-completed">
        <CheckCircle2 className="size-4" aria-hidden /> Completed
      </p>
    );
  }
  return (
    <Button onClick={() => done.mutate()} loading={done.isPending} data-testid="lesson-mark-done">
      Mark as done
    </Button>
  );
}

export function ArticleLecture({ content, html }: { content: LectureContent; html: string }) {
  return (
    <article className="mx-auto max-w-[720px] pt-2">
      <div className="lms-prose" dangerouslySetInnerHTML={{ __html: html }} data-testid="lesson-article" />
      <div className="mt-10 border-t border-border pt-6">
        <MarkDone content={content} />
      </div>
    </article>
  );
}

export function PdfLecture({ content, pdf }: { content: LectureContent; pdf: { url: string; fileName: string; sizeBytes: number | null } | null }) {
  if (!pdf) {
    return (
      <div className="flex h-[320px] flex-col items-center justify-center gap-2 rounded-card bg-ground-2 text-center" role="status">
        <FileText className="size-6 text-muted-foreground" aria-hidden />
        <p className="font-semibold">This PDF is not available yet</p>
      </div>
    );
  }
  const size = formatBytes(pdf.sizeBytes);
  return (
    <div>
      <iframe src={pdf.url} title={pdf.fileName} className="hidden h-[78vh] w-full rounded-card border-0 bg-card shadow-card md:block" data-testid="lesson-pdf" />
      {/* Phones rarely render PDFs inline: offer the file instead. */}
      <div className="flex items-center gap-4 rounded-card bg-card p-4 shadow-card md:hidden">
        <FileText className="size-8 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{pdf.fileName}</p>
          <p className="text-[13px] text-muted-foreground">PDF{size ? ` · ${size}` : ""}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <MarkDone content={content} />
        <Button asChild variant="outline">
          <a href={pdf.url} download={pdf.fileName} target="_blank" rel="noopener noreferrer" data-testid="lesson-pdf-download">
            <Download /> Download{size ? ` (${size})` : ""}
          </a>
        </Button>
      </div>
    </div>
  );
}
