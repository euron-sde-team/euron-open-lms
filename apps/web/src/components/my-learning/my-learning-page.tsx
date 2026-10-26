"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Award, Bookmark, Download, GraduationCap } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import type { Certificate, CourseCard as CourseCardDto, LearningEntry, LearningSummary, Page as PageDto } from "@open-lms/types";
import { Button, EmptyState, Skeleton, toast } from "@open-lms/ui";
import { learnHref } from "@/components/classroom/classroom-context";
import { ErrorState, LoadMore } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { CourseCard, CourseCardSkeleton, CourseGrid, courseHref } from "@/components/course/course-card";
import { CourseCover } from "@/components/course/course-cover";
import { ProgressLine } from "@/components/course/progress-line";
import { Page, PageHeader } from "@/components/shell/layouts";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";

type Tab = "in-progress" | "completed" | "saved" | "certificates";
const TABS: { value: Tab; label: string }[] = [
  { value: "in-progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "saved", label: "Saved" },
  { value: "certificates", label: "Certificates" },
];

const dateFmt = (iso: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));

/** "3 in progress · 2 completed · 1 certificate · 45 min this week · 4 day streak", only the parts that are real. */
export function summaryLine(s: LearningSummary): string {
  const parts = [
    `${s.inProgress} in progress`,
    `${s.completed} completed`,
    `${s.certificates} ${s.certificates === 1 ? "certificate" : "certificates"}`,
    s.minutesThisWeek > 0 ? `${s.minutesThisWeek >= 60 ? `${Math.floor(s.minutesThisWeek / 60)} h ${s.minutesThisWeek % 60} min` : `${s.minutesThisWeek} min`} this week` : null,
    s.streakDays > 1 ? `${s.streakDays} day streak` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function MyLearningPage() {
  return (
    <Suspense fallback={null}>
      <MyLearning />
    </Suspense>
  );
}

function MyLearning() {
  const params = useSearchParams();
  const raw = params?.get("tab") as Tab | null;
  const tab: Tab = raw && TABS.some((t) => t.value === raw) ? raw : "in-progress";
  const summary = useQuery({ queryKey: qk.mySummary, queryFn: () => api().my.summary(), meta: { silent: true } });
  return (
    <Page>
      <PageHeader title="My learning" lead={summary.data ? <span data-testid="my-learning-summary">{summaryLine(summary.data)}</span> : <Skeleton className="h-4 w-80" />} />
      <UnderlineTabs label="My learning" tabs={TABS.map((t) => ({ ...t, href: t.value === "in-progress" ? "/my-learning" : `/my-learning?tab=${t.value}` }))} value={tab} />
      <div className="pt-6">
        {tab === "in-progress" ? <EntryList status="in_progress" /> : null}
        {tab === "completed" ? <EntryList status="completed" /> : null}
        {tab === "saved" ? <SavedTab /> : null}
        {tab === "certificates" ? <CertificatesTab /> : null}
      </div>
    </Page>
  );
}

function EntryList({ status }: { status: "in_progress" | "completed" }) {
  const list = usePagedList<LearningEntry>({ queryKey: qk.myLearning(status), fetchPage: (cursor) => api().my.learning({ status, cursor, limit: 20 }) });
  if (list.isPending) {
    return (
      <div className="divide-y divide-border">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex gap-4 py-5">
            <Skeleton className="aspect-video w-40 shrink-0 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="mt-4 h-1.5 w-full max-w-sm" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.items.length) {
    return status === "in_progress" ? (
      <EmptyState
        icon={<GraduationCap />}
        title="Nothing in progress"
        description="Courses you start show up here with your progress."
        action={
          <Button asChild>
            <Link href="/courses">Browse courses</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState icon={<Award />} title="No completed courses yet" description="Finish every lesson in a course and it moves here." />
    );
  }
  return (
    <>
      <ul className="divide-y divide-border border-b border-border" data-testid="my-learning-list">
        {list.items.map((e) => (
          <EntryRow key={e.enrollmentId} entry={e} />
        ))}
      </ul>
      <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
    </>
  );
}

function EntryRow({ entry: e }: { entry: LearningEntry }) {
  const c = e.course;
  const href = e.active ? learnHref(c.slug, e.resumeItem?.id) : courseHref(c.slug);
  return (
    <li className="group relative flex flex-col gap-4 py-5 sm:flex-row" data-testid="learning-entry">
      <Link href={href} className="shrink-0 sm:w-48" tabIndex={-1} aria-hidden>
        <CourseCover src={c.coverUrl} title={c.title} seed={c.categories[0]?.slug ?? c.slug} size="sm" rounded="all" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href} className="font-display text-[18px] font-semibold leading-snug tracking-[-0.01em] hover:text-primary">
          {c.title}
        </Link>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{c.instructors.map((i) => i.displayName).join(", ")}</p>
        {e.active ? (
          <>
            <ProgressLine percent={e.progressPercent} completed={e.completedItems} total={e.totalItems} showEmpty className="mt-3 max-w-md" />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px]">
              {e.completedAt ? (
                <span className="text-muted-foreground">Completed {dateFmt(e.completedAt)}</span>
              ) : e.resumeItem ? (
                <Link href={learnHref(c.slug, e.resumeItem.id)} className="font-semibold text-link hover:underline" data-testid="learning-resume">
                  Resume: {e.resumeItem.title}
                </Link>
              ) : (
                <Link href={learnHref(c.slug)} className="font-semibold text-link hover:underline" data-testid="learning-resume">
                  Start the course
                </Link>
              )}
              {e.certificate ? (
                <Link href={`/verify/${encodeURIComponent(e.certificate.serial)}`} className="font-medium text-link hover:underline">
                  View certificate
                </Link>
              ) : null}
              {e.validUntil && !e.completedAt ? <span className="text-muted-foreground">Access until {dateFmt(e.validUntil)}</span> : null}
            </div>
          </>
        ) : (
          <p className="mt-3 text-[13.5px]" data-testid="learning-lapsed">
            <span className="font-semibold">Access ended.</span> <span className="text-muted-foreground">Your progress ({e.progressPercent}%) is kept.</span>{" "}
            <Link href={courseHref(c.slug)} className="font-medium text-link hover:underline">
              See ways to continue
            </Link>
          </p>
        )}
      </div>
    </li>
  );
}

function SavedTab() {
  const qc = useQueryClient();
  const saved = usePagedList<CourseCardDto>({ queryKey: qk.mySaved, fetchPage: (cursor) => api().my.saved({ cursor, limit: 24 }) });
  const unsave = useMutation({
    mutationFn: (c: CourseCardDto) => api().catalog.unsave(c.slug),
    onMutate: async (c) => {
      await qc.cancelQueries({ queryKey: qk.mySaved });
      const prev = qc.getQueryData<InfiniteData<PageDto<CourseCardDto>>>(qk.mySaved);
      qc.setQueryData<InfiniteData<PageDto<CourseCardDto>>>(qk.mySaved, (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== c.id) })) } : d));
      return { prev };
    },
    onError: (_e, _c, ctx) => ctx?.prev && qc.setQueryData(qk.mySaved, ctx.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.catalogAll });
      void qc.invalidateQueries({ queryKey: qk.courseAll });
    },
  });
  return (
    <div className="space-y-12">
      <section aria-labelledby="saved-courses">
        <h2 id="saved-courses" className="mb-4 font-display text-[20px] font-semibold tracking-[-0.01em]">
          Saved courses
        </h2>
        {saved.isPending ? (
          <CourseGrid>
            {Array.from({ length: 4 }, (_, i) => (
              <CourseCardSkeleton key={i} />
            ))}
          </CourseGrid>
        ) : !saved.items.length ? (
          <EmptyState compact icon={<Bookmark />} title="No saved courses" description="Save a course from its card to find it here later." />
        ) : (
          <>
            <CourseGrid>
              {saved.items.map((c) => (
                <CourseCard key={c.id} course={c} onToggleSave={(x) => unsave.mutate(x)} />
              ))}
            </CourseGrid>
            <LoadMore sentinelRef={saved.sentinelRef} loading={saved.isFetchingNextPage} hasMore={!!saved.hasNextPage} />
          </>
        )}
      </section>
      <Bookmarks />
    </div>
  );
}

function Bookmarks() {
  const list = usePagedList<{ item: { id: string; title: string; kind: string }; course: { slug: string; title: string }; createdAt: string; id?: string }>({
    queryKey: qk.myBookmarks,
    fetchPage: async (cursor) => {
      const page = await api().my.bookmarks({ cursor, limit: 30 });
      return { ...page, items: page.items.map((b) => ({ ...b, id: b.item.id })) };
    },
  });
  return (
    <section aria-labelledby="bookmarks">
      <h2 id="bookmarks" className="mb-2 font-display text-[20px] font-semibold tracking-[-0.01em]">
        Bookmarked lessons
      </h2>
      {list.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : !list.items.length ? (
        <p className="text-[14px] text-muted-foreground">Bookmark lessons from the course content list in the classroom to come back to them.</p>
      ) : (
        <>
          <ul className="divide-y divide-border border-y border-border" data-testid="my-bookmarks">
            {list.items.map((b) => (
              <li key={b.item.id}>
                <Link href={learnHref(b.course.slug, b.item.id)} className="flex flex-col py-3 hover:bg-muted/50 sm:flex-row sm:items-center sm:gap-4">
                  <span className="min-w-0 flex-1 truncate font-medium">{b.item.title}</span>
                  <span className="truncate text-[13px] text-muted-foreground">{b.course.title}</span>
                </Link>
              </li>
            ))}
          </ul>
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} />
        </>
      )}
    </section>
  );
}

function CertificatesTab() {
  const q = useQuery({ queryKey: qk.myCertificates, queryFn: () => api().my.certificates() });
  if (q.isPending) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data.length) return <EmptyState icon={<Award />} title="No certificates yet" description="Complete a course that offers a certificate and it appears here, ready to share." />;
  return (
    <ul className="divide-y divide-border border-y border-border" data-testid="my-certificates">
      {q.data.map((c) => (
        <CertificateRow key={c.serial} cert={c} />
      ))}
    </ul>
  );
}

function CertificateRow({ cert: c }: { cert: Certificate }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const blob = await api().certificates.downloadPdf(c.serial);
      saveBlob(blob, `certificate-${c.serial}.pdf`);
    } catch (e) {
      if (isApiError(e) && e.code === "CERTIFICATE_RENDERING") toast.info({ title: "Your certificate is being prepared", description: "It is usually ready within a minute. Try again shortly." });
      else if (isApiError(e) && e.code === "NETWORK_ERROR" && c.pdfUrl) window.open(c.pdfUrl, "_blank", "noopener");
      else toast.error({ title: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center" data-testid="certificate-row">
      <div className="min-w-0 flex-1">
        <Link href={`/verify/${encodeURIComponent(c.serial)}`} className="font-display text-[17px] font-semibold hover:text-primary">
          {c.courseTitle}
        </Link>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Issued {dateFmt(c.issuedAt)} · No. {c.serial}
          {c.revoked ? " · Revoked" : ""}
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/verify/${encodeURIComponent(c.serial)}`}>View</Link>
        </Button>
        {!c.revoked ? (
          <Button variant="outline" size="sm" onClick={() => void download()} loading={busy} data-testid="certificate-download">
            <Download /> PDF
          </Button>
        ) : null}
      </div>
    </li>
  );
}
