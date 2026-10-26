"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { flattenAll, nextCursor, type AdminCourseLearner } from "@open-lms/api-client";
import type { AdminCourse, EnrollmentSource } from "@open-lms/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { TimeAgo } from "@/components/common/time-ago";
import { UserAvatar } from "@/components/common/user-bits";
import { ProgressLine } from "@/components/course/progress-line";
import { DataTable, type Column } from "@/components/admin/shell/data-table";
import { useAdminSession } from "@/components/admin/shell/session";

const SOURCE: Record<EnrollmentSource, string> = { FREE: "Free", PURCHASE: "Purchased", BUNDLE: "Bundle", SUBSCRIPTION: "Subscription", GRANT: "Granted" };

export function LearnersTab({ course }: { course: AdminCourse }) {
  const viewer = useAdminSession();
  const list = useInfiniteQuery({
    queryKey: qk.admin.list("course-learners", { courseId: course.id }),
    queryFn: ({ pageParam }) => api().authoring.courses.learners(course.id, { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });
  const rows = flattenAll(list.data?.pages);
  const canOpen = viewer.can("learners");
  const columns: Column<AdminCourseLearner>[] = [
    {
      key: "user",
      header: "Learner",
      cell: (r) => (
        <div className="flex min-w-[200px] items-center gap-3">
          <UserAvatar user={r.user} size="sm" />
          <div className="min-w-0">
            {canOpen ? (
              <Link href={`/admin/learners?open=${r.user.id}`} className="block truncate font-medium hover:underline">
                {r.user.displayName}
              </Link>
            ) : (
              <p className="truncate font-medium">{r.user.displayName}</p>
            )}
            <p className="truncate text-[12.5px] text-muted-foreground">@{r.user.username}</p>
          </div>
        </div>
      ),
    },
    {
      key: "progress",
      header: "Progress",
      sortValue: (r) => r.progressPercent,
      cell: (r) => (
        <ProgressLine percent={r.completedAt ? 100 : r.progressPercent} showEmpty className="w-40" />
      ),
    },
    { key: "source", header: "Access", hideBelow: "sm", cell: (r) => <span className="text-muted-foreground">{SOURCE[r.source]}</span> },
    { key: "enrolled", header: "Enrolled", align: "right", hideBelow: "md", sortValue: (r) => r.createdAt, cell: (r) => <TimeAgo value={r.createdAt} className="text-[13px] text-muted-foreground" /> },
  ];
  return (
    <DataTable
      rows={rows}
      loading={list.isPending}
      error={list.error}
      onRetry={() => void list.refetch()}
      hasMore={!!list.hasNextPage}
      loadingMore={list.isFetchingNextPage}
      onLoadMore={() => void list.fetchNextPage()}
      columns={columns}
      rowKey={(r) => r.user.id}
      caption="Enrolled learners"
      testId="course-learners"
      empty={{ icon: <Users />, title: "No learners yet", description: course.status === "PUBLISHED" ? "Learners appear here when they enroll." : "Learners can enroll once the course is published." }}
    />
  );
}
