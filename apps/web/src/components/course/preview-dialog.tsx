"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import type { CurriculumItemPublic } from "@open-lms/types";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Skeleton } from "@open-lms/ui";
import { VideoPlayer } from "@/components/player";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";

/** A free preview from the curriculum: the video in the shared player, or the article / PDF. */
export function PreviewDialog({ item, courseTitle, onOpenChange }: { item: CurriculumItemPublic | null; courseTitle: string; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-w-[960px]" data-testid="preview-dialog">
        {item ? (
          <>
            <DialogHeader>
              <DialogDescription className="mt-0 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-primary">Free preview · {courseTitle}</DialogDescription>
              <DialogTitle className="mt-1 font-display text-[20px] font-semibold tracking-[-0.01em]">{item.title}</DialogTitle>
            </DialogHeader>
            {item.lectureKind === "VIDEO" ? <VideoPreview item={item} /> : <ReadingPreview item={item} />}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function VideoPreview({ item }: { item: CurriculumItemPublic }) {
  const q = useQuery({
    queryKey: ["preview-playback", item.id],
    queryFn: () => api().learn.playback(item.id),
    staleTime: Infinity,
    gcTime: 0,
    meta: { silent: true },
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-16" />;
  if (!q.data) return <Skeleton className="aspect-video w-full rounded-none" />;
  return <VideoPlayer source={q.data} title={`Preview: ${item.title}`} autoPlay onRefresh={() => api().learn.playback(item.id)} />;
}

function ReadingPreview({ item }: { item: CurriculumItemPublic }) {
  const q = useQuery({ queryKey: ["preview-item", item.id], queryFn: () => api().learn.item(item.id), gcTime: 0, meta: { silent: true } });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-16" />;
  if (!q.data) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  const c = q.data;
  if (c.kind !== "LECTURE") {
    return <p className="p-6 text-[14.5px] text-muted-foreground">Quizzes and projects open in the classroom once you have access to the course.</p>;
  }
  const l = c.lecture;
  if (l.lectureKind === "ARTICLE") {
    return <div className="lms-prose max-h-[70dvh] overflow-y-auto px-6 py-5" dangerouslySetInnerHTML={{ __html: l.html }} />;
  }
  if (l.lectureKind === "PDF") {
    if (!l.pdf) return <p className="p-6 text-[14.5px] text-muted-foreground">This PDF is not available right now.</p>;
    return (
      <div className="flex flex-col">
        <iframe src={l.pdf.url} title={l.pdf.fileName} className="h-[70dvh] w-full border-0 bg-muted" />
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button asChild variant="outline" size="sm">
            <a href={l.pdf.url} target="_blank" rel="noreferrer" download={l.pdf.fileName}>
              <Download /> Download {l.pdf.fileName}
            </a>
          </Button>
        </div>
      </div>
    );
  }
  return <p className="p-6 text-[14.5px] text-muted-foreground">Open the classroom to watch this lesson.</p>;
}
