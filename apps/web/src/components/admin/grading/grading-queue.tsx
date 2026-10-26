"use client";

import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { flattenAll, nextCursor } from "@open-lms/api-client";
import { Badge, Select } from "@open-lms/ui";
import type { GradingRow, SubmissionStatus } from "@open-lms/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar } from "@/components/common/user-bits";
import { AdminPage } from "@/components/admin/shell/admin-page";
import { DataTable, type Column } from "@/components/admin/shell/data-table";
import { FilterBar } from "@/components/admin/shell/filter-bar";
import { useUrlState } from "@/components/admin/shell/url-state";

export const SUBMISSION_LABEL: Record<SubmissionStatus, string> = { SUBMITTED: "Waiting for review", CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved", REJECTED: "Rejected" };
export const SUBMISSION_TONE: Record<SubmissionStatus, "neutral" | "warning" | "success" | "danger"> = { SUBMITTED: "neutral", CHANGES_REQUESTED: "warning", APPROVED: "success", REJECTED: "danger" };

const TABS: { value: SubmissionStatus; label: string }[] = [
  { value: "SUBMITTED", label: "Submitted" },
  { value: "CHANGES_REQUESTED", label: "Changes requested" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

export const gradingListKey = (f: Record<string, unknown>) => qk.admin.list("grading", f);

export function useCourseOptions() {
  return useQuery({
    queryKey: qk.admin.list("courses", { picker: true }),
    queryFn: () => api().authoring.courses.list({ limit: 50 }),
    staleTime: 60_000,
    meta: { silent: true },
  });
}

/** Where a grading detail link goes, keeping the queue's course filter for "next". */
export const gradingHref = (submissionId: string, courseId?: string | null) => `/admin/grading/${submissionId}${courseId ? `?course=${encodeURIComponent(courseId)}` : ""}`;

export function GradingQueue() {
  const router = useRouter();
  const url = useUrlState();
  const status = (TABS.some((t) => t.value === url.get("status")) ? url.get("status") : "SUBMITTED") as SubmissionStatus;
  const courseId = url.get("course") || undefined;
  const courses = useCourseOptions();
  const list = useInfiniteQuery({
    queryKey: gradingListKey({ status, courseId }),
    queryFn: ({ pageParam }) => api().grading.list({ status, courseId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });
  const rows = flattenAll(list.data?.pages);

  const columns: Column<GradingRow>[] = [
    {
      key: "learner",
      header: "Learner",
      cell: (r) => (
        <div className="flex min-w-[180px] items-center gap-3">
          <UserAvatar user={r.learner} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium">{r.learner.displayName}</p>
            <p className="truncate text-[12.5px] text-muted-foreground">{r.learner.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "item",
      header: "Assignment",
      cell: (r) => (
        <div className="min-w-[180px]">
          <p className="line-clamp-1 font-medium">{r.item.title}</p>
          <p className="line-clamp-1 text-[12.5px] text-muted-foreground">{r.course.title}</p>
        </div>
      ),
    },
    {
      key: "version",
      header: "Version",
      hideBelow: "md",
      cell: (r) => (
        <span className="text-[13px] text-muted-foreground">
          {r.version > 1 ? `Resubmission ${r.version}` : "First"}
          {r.isLate ? <span className="font-medium text-warning-soft-foreground"> · Late</span> : null}
          {r.hasAiSuggestion ? " · AI draft ready" : null}
        </span>
      ),
    },
    { key: "status", header: "Status", hideBelow: "sm", cell: (r) => <Badge tone={SUBMISSION_TONE[r.status]}>{SUBMISSION_LABEL[r.status]}</Badge> },
    { key: "submitted", header: "Submitted", align: "right", sortValue: (r) => r.submittedAt, cell: (r) => <TimeAgo value={r.submittedAt} className="text-[13px] text-muted-foreground" /> },
  ];

  return (
    <AdminPage
      title="Grading"
      description="Assignment submissions waiting for a decision, oldest first."
      testId="admin-grading"
      filters={
        <FilterBar tabs={TABS} tab={status} onTabChange={(v) => url.set({ status: v === "SUBMITTED" ? null : v })} tabsLabel="Submission status" testId="grading-filter">
          <div className="w-full sm:w-64">
            <Select
              aria-label="Course"
              value={courseId ?? "all"}
              onValueChange={(v) => url.set({ course: v === "all" ? null : v })}
              options={[{ value: "all", label: "All courses" }, ...(courses.data?.items ?? []).map((c) => ({ value: c.id, label: c.title }))]}
              className="h-9"
              data-testid="grading-course"
            />
          </div>
        </FilterBar>
      }
    >
      <DataTable
        rows={rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        hasMore={!!list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        columns={columns}
        rowKey={(r) => r.submissionId}
        caption="Submissions"
        onRowClick={(r) => router.push(gradingHref(r.submissionId, courseId))}
        testId="grading-table"
        rowTestId={(r) => `grading-row-${r.submissionId}`}
        empty={{
          icon: <ClipboardCheck />,
          title: status === "SUBMITTED" ? "Nothing waiting for review" : `No ${SUBMISSION_LABEL[status].toLowerCase()} submissions`,
          description: status === "SUBMITTED" ? "New assignment submissions land here." : undefined,
        }}
      />
    </AdminPage>
  );
}
