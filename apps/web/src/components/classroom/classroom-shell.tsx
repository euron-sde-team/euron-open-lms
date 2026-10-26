"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Award, ListTree, Lock, Moon, Sun } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Button, DialogTitle, EmptyState, IconButton, Sheet, SheetContent, Skeleton } from "@open-lms/ui";
import { courseHref } from "@/components/course/course-card";
import { ErrorState } from "@/components/common/states";
import { RequireAuth } from "@/components/common/require-auth";
import { AvatarMenu } from "@/components/shell/avatar-menu";
import type { VideoPlayerHandle } from "@/components/player/video-player";
import { api } from "@/lib/api";
import { neighbours } from "@/lib/classroom/curriculum";
import { qk } from "@/lib/query-keys";
import { resolveTheme, useTheme } from "@/lib/stores/theme";
import { ClassroomProvider, learnHref, useClassroom, type ClassroomContextValue } from "./classroom-context";
import { CompletionBanner } from "./completion";
import { CurriculumPanel } from "./curriculum-panel";

export function ClassroomShell({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <RequireAuth>
      <ClassroomLoader slug={slug}>{children}</ClassroomLoader>
    </RequireAuth>
  );
}

function ClassroomLoader({ slug, children }: { slug: string; children: ReactNode }) {
  const params = useParams<{ itemId?: string }>();
  const itemId = params?.itemId ? decodeURIComponent(params.itemId) : null;
  const query = useQuery({ queryKey: qk.classroom(slug), queryFn: () => api().learn.classroom(slug), staleTime: 60_000 });
  const player = useRef<VideoPlayerHandle | null>(null);
  const [finished, setFinished] = useState<{ serial: string | null } | null>(null);
  const [sheet, setSheet] = useState(false);
  const openCurriculum = useCallback(() => setSheet(true), []);

  const value = useMemo<ClassroomContextValue | null>(
    () => (query.data ? { slug, classroom: query.data, itemId, player, finished, setFinished, openCurriculum } : null),
    [query.data, slug, itemId, finished, openCurriculum],
  );

  if (query.isPending) return <ShellSkeleton />;
  if (query.isError || !value) return <ClassroomBlocked slug={slug} error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <ClassroomProvider value={value}>
      <div className="flex h-dvh flex-col bg-background">
        <a href="#main" className="sr-only z-[100] rounded-md bg-card px-3 py-2 font-semibold focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
          Skip to lesson
        </a>
        <TopBar />
        <KeyboardNav />
        <div className="flex min-h-0 flex-1">
          <main id="main" className="scrollbar-thin min-w-0 flex-1 overflow-y-auto" data-testid="classroom-main">
            {finished ? (
              <CompletionBanner
                courseTitle={value.classroom.course.title}
                serial={finished.serial ?? value.classroom.certificate?.serial ?? null}
                certificateEnabled={value.classroom.course.certificateEnabled}
                onDismiss={() => setFinished(null)}
              />
            ) : null}
            {children}
          </main>
          <aside className="scrollbar-thin hidden w-[340px] shrink-0 overflow-y-auto border-l border-border bg-card/40 lg:block xl:w-[380px]">
            <CurriculumPanel />
          </aside>
        </div>
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent side="right" width="max-w-[400px]" className="overflow-y-auto">
            <DialogTitle className="sr-only">Course content</DialogTitle>
            <CurriculumPanel onNavigate={() => setSheet(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </ClassroomProvider>
  );
}

function TopBar() {
  const { slug, classroom, openCurriculum } = useClassroom();
  const { pref, setPref } = useTheme();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const sync = () => setDark(resolveTheme(pref, !!mq?.matches) === "dark");
    sync();
    mq?.addEventListener?.("change", sync);
    return () => mq?.removeEventListener?.("change", sync);
  }, [pref]);
  const e = classroom.enrollment;
  const percent = e?.progressPercent ?? 0;
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-3 backdrop-blur sm:px-4" data-testid="classroom-topbar">
      <IconButton asChild label="Back to the course page" variant="ghost">
        <Link href={courseHref(slug)} data-testid="classroom-back">
          <ArrowLeft />
        </Link>
      </IconButton>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[15.5px] font-semibold tracking-[-0.01em]" title={classroom.course.title}>
          {classroom.course.title}
        </p>
        {e ? (
          <div className="mt-1 flex max-w-[360px] items-center gap-2" data-testid="classroom-progress">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-ground-2" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className={percent >= 100 ? "h-full rounded-full bg-success transition-[width] duration-500" : "h-full rounded-full bg-brand transition-[width] duration-500"} style={{ width: `${percent}%` }} />
            </div>
            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
              {percent >= 100 ? "Completed" : `${percent}%`}
              <span className="hidden sm:inline">
                {" "}
                · {e.completedItems} of {e.totalItems}
              </span>
            </span>
          </div>
        ) : null}
      </div>
      {classroom.certificate ? (
        <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
          <Link href={`/verify/${encodeURIComponent(classroom.certificate.serial)}`} data-testid="classroom-certificate">
            <Award /> Certificate
          </Link>
        </Button>
      ) : null}
      <IconButton label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setPref(dark ? "light" : "dark")} data-testid="classroom-theme">
        {dark ? <Sun /> : <Moon />}
      </IconButton>
      <IconButton label="Course content" className="lg:hidden" onClick={openCurriculum} data-testid="classroom-open-curriculum">
        <ListTree />
      </IconButton>
      <AvatarMenu />
    </header>
  );
}

/** Alt+Right / Alt+Left move through the curriculum (not while typing). */
function KeyboardNav() {
  const { slug, classroom, itemId } = useClassroom();
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const { prev, next } = neighbours(classroom, itemId);
      const to = e.key === "ArrowRight" ? next : prev;
      if (!to) return;
      e.preventDefault();
      router.push(learnHref(slug, to.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [classroom, itemId, router, slug]);
  return null;
}

function ClassroomBlocked({ slug, error, onRetry }: { slug: string; error: unknown; onRetry: () => void }) {
  const access = isApiError(error) && error.code === "COURSE_ACCESS_REQUIRED";
  const lapsed = access && error.reason && error.reason !== "NOT_ENROLLED";
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4">
        <IconButton asChild label="Back to the course page" variant="ghost">
          <Link href={courseHref(slug)}>
            <ArrowLeft />
          </Link>
        </IconButton>
      </header>
      <div className="flex flex-1 items-center justify-center px-4">
        {access ? (
          <EmptyState
            icon={<Lock />}
            title={lapsed ? "Your access to this course ended" : "You need access to this course"}
            description={lapsed ? "Your progress is saved. Renew access from the course page to continue." : "Enroll from the course page to open the lessons."}
            action={
              <Button asChild>
                <Link href={courseHref(slug)}>Go to the course page</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={error} onRetry={onRetry} />
        )}
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex h-dvh flex-col" aria-busy="true" aria-label="Loading the classroom">
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-1 w-48" />
        </div>
      </div>
      <div className="flex flex-1">
        <div className="flex-1 p-4 sm:p-6">
          <Skeleton className="mx-auto aspect-video w-full max-w-[1100px] rounded-card" />
          <Skeleton className="mx-auto mt-5 h-6 w-full max-w-[1100px]" />
        </div>
        <div className="hidden w-[340px] space-y-3 border-l border-border p-4 lg:block xl:w-[380px]">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
