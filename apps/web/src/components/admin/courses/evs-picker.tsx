"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Film } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState, Skeleton, cn } from "@open-lms/ui";
import type { EvsVideo } from "@open-lms/types";
import { api } from "@/lib/api";
import { clock } from "@/lib/duration";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { SearchInput } from "@/components/admin/shell/filter-bar";

/** Pick a video from the EVS library (GET /admin/evs/videos). */
export function EvsPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (v: EvsVideo) => void }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: qk.admin.list("evs-videos", { q, page }),
    queryFn: () => api().authoring.evs.videos({ q: q || undefined, page }),
    enabled: open,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const items = list.data?.items ?? [];
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / Math.max(1, items.length || 1))) : 1;
  const hasNext = !!list.data && page * Math.max(items.length, 1) < list.data.total && items.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="evs-picker">
        <DialogHeader>
          <DialogTitle>Choose a video</DialogTitle>
          <DialogDescription>Videos on your video service. Only ready videos play for learners.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search videos"
            className="sm:w-full"
            testId="evs-search"
          />
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
          ) : list.isPending ? (
            <ul className="divide-y divide-border" aria-busy>
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex items-center gap-3 py-2.5">
                  <Skeleton className="aspect-video w-24 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </li>
              ))}
            </ul>
          ) : !items.length ? (
            <EmptyState compact icon={<Film />} title={q ? "No videos match" : "No videos yet"} description={q ? "Try another word." : "Upload videos on your video service, then pick them here."} />
          ) : (
            <ul className={cn("max-h-[55vh] divide-y divide-border overflow-y-auto", list.isFetching && "opacity-70")} aria-label="Videos">
              {items.map((v) => {
                const ready = /ready/i.test(v.status);
                return (
                  <li key={v.id}>
                    <button type="button" onClick={() => onPick(v)} className="flex w-full items-center gap-3 rounded-md py-2.5 text-left hover:bg-muted focus-visible:bg-muted" data-testid={`evs-video-${v.id}`}>
                      <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md bg-muted">
                        {v.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
                        ) : (
                          <Film className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-subtle-foreground" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{v.title || v.id}</span>
                        <span className="block text-[12.5px] text-muted-foreground">
                          <span className={ready ? undefined : "text-warning-soft-foreground"}>{ready ? "Ready" : v.status.charAt(0).toUpperCase() + v.status.slice(1).toLowerCase()}</span>
                          {v.durationSeconds ? ` · ${clock(v.durationSeconds)}` : ""}
                          {` · ${v.id}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {list.data && (page > 1 || hasNext) ? (
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page}
                {pages > 1 ? ` · ${list.data.total} videos` : ""}
              </span>
              <Button variant="ghost" size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
