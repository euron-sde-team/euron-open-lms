"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, Star } from "lucide-react";
import { fieldErrorsOf, isApiError } from "@open-lms/api-client";
import { AvatarStack, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input } from "@open-lms/ui";
import type { AdminCourseRow, CourseStatus } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { TimeAgo } from "@/components/common/time-ago";
import { CourseCover } from "@/components/course/course-cover";
import { AdminPage } from "@/components/admin/shell/admin-page";
import { DataTable, pagedTable, type Column } from "@/components/admin/shell/data-table";
import { FilterBar } from "@/components/admin/shell/filter-bar";
import { useAdminSession } from "@/components/admin/shell/session";
import { useUrlState } from "@/components/admin/shell/url-state";
import { ACCESS_LABEL, CourseStatusBadge, courseKey, courseListKey } from "./course-bits";

type Tab = "ALL" | CourseStatus;
const TABS: { value: Tab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
];

const columns: Column<AdminCourseRow>[] = [
  {
    key: "title",
    header: "Course",
    sortValue: (r) => r.title.toLowerCase(),
    cell: (r) => (
      <div className="flex min-w-[220px] items-center gap-3">
        <div className="w-20 shrink-0">
          <CourseCover src={r.coverUrl} title={r.title} seed={r.slug} size="sm" rounded="all" className="rounded-md [&_p]:hidden" />
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium text-foreground">{r.title}</p>
          <p className="truncate text-[12.5px] text-subtle-foreground">/{r.slug}</p>
        </div>
      </div>
    ),
  },
  { key: "status", header: "Status", cell: (r) => <CourseStatusBadge status={r.status} /> },
  { key: "access", header: "Access", hideBelow: "md", cell: (r) => <span className="text-muted-foreground">{ACCESS_LABEL[r.accessMode]}</span> },
  { key: "items", header: "Lessons", align: "right", hideBelow: "lg", sortValue: (r) => r.itemCount, cell: (r) => r.itemCount },
  { key: "learners", header: "Learners", align: "right", hideBelow: "sm", sortValue: (r) => r.enrollmentCount, cell: (r) => r.enrollmentCount.toLocaleString() },
  {
    key: "rating",
    header: "Rating",
    align: "right",
    hideBelow: "lg",
    sortValue: (r) => r.rating?.average ?? null,
    cell: (r) =>
      r.rating && r.rating.count > 0 ? (
        <span className="inline-flex items-center gap-1">
          <Star className="size-3.5 fill-star text-star" aria-hidden />
          {r.rating.average.toFixed(1)}
          <span className="text-subtle-foreground">({r.rating.count})</span>
        </span>
      ) : (
        <span className="text-subtle-foreground">None yet</span>
      ),
  },
  {
    key: "prices",
    header: "Price",
    hideBelow: "md",
    cell: (r) =>
      r.accessMode === "FREE" ? (
        <span className="text-muted-foreground">Free</span>
      ) : r.prices.length ? (
        <span className="text-[13px]">{r.prices.map((p) => formatMoney(p, { compact: true })).join(" · ")}</span>
      ) : (
        <span className="text-subtle-foreground">Not set</span>
      ),
  },
  {
    key: "staff",
    header: "Staff",
    hideBelow: "lg",
    cell: (r) => (r.staff.length ? <AvatarStack people={r.staff.map((s) => ({ id: s.id, name: s.displayName, src: s.avatarUrl }))} max={3} /> : null),
  },
  { key: "updated", header: "Updated", align: "right", hideBelow: "sm", sortValue: (r) => r.updatedAt, cell: (r) => <TimeAgo value={r.updatedAt} className="text-[13px] text-muted-foreground" /> },
];

export function CoursesPage() {
  const viewer = useAdminSession();
  const router = useRouter();
  const url = useUrlState();
  const tab = (TABS.some((t) => t.value === url.get("status")) ? url.get("status") : "ALL") as Tab;
  const q = url.get("q");
  const [creating, setCreating] = useState(false);
  const canCreate = viewer.role === "ADMIN" || viewer.role === "INSTRUCTOR";

  const filters = { status: tab === "ALL" ? undefined : tab, q: q || undefined };
  const list = usePagedList<AdminCourseRow>({
    queryKey: courseListKey(filters),
    fetchPage: (cursor) => api().authoring.courses.list({ ...filters, cursor }),
  });

  return (
    <AdminPage
      title="Courses"
      description={viewer.allCourses ? "Every course in the academy." : "The courses you own, edit or grade."}
      testId="admin-courses"
      actions={
        canCreate ? (
          <Button onClick={() => setCreating(true)} data-testid="course-new">
            <Plus /> New course
          </Button>
        ) : null
      }
      filters={
        <FilterBar
          tabs={TABS}
          tab={tab}
          onTabChange={(v) => url.set({ status: v === "ALL" ? null : v })}
          tabsLabel="Course status"
          search={q}
          onSearchChange={(v) => url.set({ q: v })}
          searchPlaceholder="Search courses"
          testId="courses-filter"
        />
      }
    >
      <DataTable
        {...pagedTable(list)}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Courses"
        onRowClick={(r) => router.push(`/admin/courses/${r.id}`)}
        testId="courses-table"
        rowTestId={(r) => `course-row-${r.slug}`}
        empty={{
          icon: <BookOpen />,
          title: q || tab !== "ALL" ? "No courses match" : "No courses yet",
          description: q || tab !== "ALL" ? "Try another word or status." : canCreate ? "Start with a title; you can fill in the rest in the editor." : "Courses you are added to will show here.",
          action:
            canCreate && !q && tab === "ALL" ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                New course
              </Button>
            ) : undefined,
        }}
      />
      <NewCourseDialog open={creating} onOpenChange={setCreating} onCreated={(id) => router.push(`/admin/courses/${id}`)} />
    </AdminPage>
  );
}

function NewCourseDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api().authoring.courses.create({ title: title.trim() }),
    meta: { silent: true },
    onSuccess: (course) => {
      qc.setQueryData(courseKey(course.id), course);
      void qc.invalidateQueries({ queryKey: qk.admin.area("courses") });
      onOpenChange(false);
      setTitle("");
      onCreated(course.id);
    },
    onError: (e) => setError(isApiError(e) && e.code === "VALIDATION_FAILED" ? (fieldErrorsOf(e.details).title ?? errorMessage(e)) : errorMessage(e)),
  });
  const t = title.trim();
  const valid = t.length >= 3 && t.length <= 120;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (create.isPending) return;
        onOpenChange(o);
        if (!o) setError(null);
      }}
    >
      <DialogContent size="sm" data-testid="new-course-dialog">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>New course</DialogTitle>
            <DialogDescription>Give it a working title. It stays a draft until you publish it.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="Title" htmlFor="new-course-title" error={error ?? undefined} hint="3 to 120 characters.">
              <Input id="new-course-title" autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!error || undefined} data-testid="new-course-title" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid} loading={create.isPending} data-testid="new-course-create">
              Create and edit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
