"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import type { ItemContent } from "@open-lms/types";
import { Button, EmptyState, Skeleton } from "@open-lms/ui";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { ErrorState } from "@/components/common/states";
import { courseHref } from "@/components/course/course-card";
import { api } from "@/lib/api";
import { findItem, itemKindLabel, neighbours } from "@/lib/classroom/curriculum";
import { formatDuration } from "@/lib/duration";
import { qk } from "@/lib/query-keys";
import { AssignmentPanel } from "./assignment-panel";
import { learnHref, useClassroom } from "./classroom-context";
import { ArticleLecture, PdfLecture } from "./lecture-doc";
import { LectureVideo } from "./lecture-video";
import { NotesPanel } from "./notes-panel";
import { OverviewPanel } from "./overview-panel";
import { QaPanel } from "./qa-panel";
import { QuizRunner } from "./quiz-runner";
import { ResourcesPanel } from "./resources-panel";

type Tab = "overview" | "notes" | "qa" | "resources";

export function ItemView({ itemId }: { itemId: string }) {
  const { slug, classroom } = useClassroom();
  const query = useQuery({ queryKey: qk.item(itemId), queryFn: () => api().learn.item(itemId) });
  const flat = findItem(classroom.sections, itemId);

  if (query.isPending) return <ItemSkeleton kind={flat?.item.kind === "LECTURE" ? flat.item.lectureKind : null} />;
  if (query.isError) {
    const e = query.error;
    if (isApiError(e) && e.code === "COURSE_ACCESS_REQUIRED") {
      return (
        <EmptyState
          className="py-24"
          icon={<Lock />}
          title="This lesson is for enrolled learners"
          description="Enroll from the course page to open it."
          action={
            <Button asChild>
              <Link href={courseHref(slug)}>Go to the course page</Link>
            </Button>
          }
        />
      );
    }
    return <ErrorState className="py-24" error={e} onRetry={() => void query.refetch()} />;
  }
  return <ItemLoaded key={itemId} content={query.data} />;
}

function ItemLoaded({ content }: { content: ItemContent }) {
  const { slug, classroom } = useClassroom();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const item = content.item;
  const { prev, next } = neighbours(classroom, item.id);
  const isLecture = content.kind === "LECTURE";
  const tabs: { value: Tab; label: string; count?: number | null }[] = [
    { value: "overview", label: "Overview" },
    { value: "notes", label: "Notes" },
    { value: "qa", label: "Q&A" },
    ...(isLecture ? [{ value: "resources" as Tab, label: "Resources", count: content.resources.length || null }] : []),
  ];
  const raw = params?.get("tab") as Tab | null;
  const tab: Tab = raw && tabs.some((t) => t.value === raw) ? raw : "overview";
  const setTab = (t: Tab) => {
    const sp = new URLSearchParams(params?.toString());
    if (t === "overview") sp.delete("tab");
    else sp.set("tab", t);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ""), { scroll: false });
  };
  const section = classroom.sections.find((s) => s.id === item.sectionId);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-4 sm:px-6 sm:pt-6" data-testid="classroom-item" data-item-kind={content.kind}>
      {content.kind === "LECTURE" ? (
        content.lecture.lectureKind === "VIDEO" ? (
          <LectureVideo content={content} lecture={content.lecture} nextItem={next} />
        ) : content.lecture.lectureKind === "ARTICLE" ? (
          <ArticleLecture content={content} html={content.lecture.html} />
        ) : (
          <PdfLecture content={content} pdf={content.lecture.pdf} />
        )
      ) : content.kind === "QUIZ" ? (
        <QuizRunner key={item.id} content={content} />
      ) : (
        <AssignmentPanel key={item.id} content={content} />
      )}

      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {section ? <p className="text-[12.5px] font-medium text-muted-foreground">{section.title}</p> : null}
          <h1 className="mt-0.5 text-balance font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[26px]" data-testid="classroom-item-title">
            {item.title}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {itemKindLabel(item)}
            {item.durationSeconds > 0 ? ` · ${formatDuration(item.durationSeconds)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild={!!prev} variant="outline" size="sm" disabled={!prev} aria-keyshortcuts="Alt+ArrowLeft" title="Previous (Alt + Left)">
            {prev ? (
              <Link href={learnHref(slug, prev.id)} data-testid="classroom-prev">
                <ChevronLeft /> Previous
              </Link>
            ) : (
              <span>
                <ChevronLeft /> Previous
              </span>
            )}
          </Button>
          <Button asChild={!!next} variant="outline" size="sm" disabled={!next} aria-keyshortcuts="Alt+ArrowRight" title="Next (Alt + Right)">
            {next ? (
              <Link href={learnHref(slug, next.id)} data-testid="classroom-next">
                Next <ChevronRight />
              </Link>
            ) : (
              <span>
                Next <ChevronRight />
              </span>
            )}
          </Button>
        </div>
      </div>

      <UnderlineTabs className="mt-6" label="Lesson sections" tabs={tabs} value={tab} onChange={setTab} />
      <div className="pt-6" role="tabpanel" aria-label={tabs.find((t) => t.value === tab)?.label}>
        {tab === "overview" ? <OverviewPanel content={content} /> : null}
        {tab === "notes" ? <NotesPanel itemId={item.id} isVideo={isLecture && content.lecture.lectureKind === "VIDEO"} /> : null}
        {tab === "qa" ? <QaPanel itemId={item.id} /> : null}
        {tab === "resources" && isLecture ? <ResourcesPanel resources={content.resources} /> : null}
      </div>
    </div>
  );
}

function ItemSkeleton({ kind }: { kind: string | null | undefined }) {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-4 sm:px-6 sm:pt-6" aria-busy="true">
      {kind === "VIDEO" || !kind ? <Skeleton className="aspect-video w-full rounded-card" /> : <Skeleton className="h-[420px] w-full rounded-card" />}
      <Skeleton className="mt-6 h-7 w-2/3" />
      <Skeleton className="mt-2 h-4 w-40" />
      <Skeleton className="mt-8 h-px w-full" />
    </div>
  );
}
