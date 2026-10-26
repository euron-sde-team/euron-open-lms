"use client";

import { Skeleton } from "@open-lms/ui";
import type { AdminCourse } from "@open-lms/types";
import { ErrorState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { AdminPage } from "@/components/admin/shell/admin-page";
import { useAdminSession } from "@/components/admin/shell/session";
import { useUrlState } from "@/components/admin/shell/url-state";
import { CourseStatusBadge, ReadOnlyNote, courseRights, useAdminCourse } from "./course-bits";
import { CurriculumBuilder } from "./curriculum-builder";
import { DetailsTab } from "./details-tab";
import { LearnersTab } from "./learners-tab";
import { PricingTab } from "./pricing-tab";
import { PublishPanel } from "./publish-panel";
import { QuestionsTab } from "./questions-tab";
import { StaffTab } from "./staff-tab";

export type EditorTab = "details" | "pricing" | "curriculum" | "questions" | "staff" | "learners";

export function CourseEditor({ courseId }: { courseId: string }) {
  const viewer = useAdminSession();
  const url = useUrlState();
  const course = useAdminCourse(courseId);

  if (course.isPending) return <EditorSkeleton />;
  if (course.error || !course.data) {
    return (
      <AdminPage title="Course" back={{ href: "/admin/courses", label: "Courses" }}>
        <ErrorState error={course.error} onRetry={() => void course.refetch()} />
      </AdminPage>
    );
  }
  const c = course.data;
  const rights = courseRights(c, viewer);
  const tabs: { value: EditorTab; label: string; count?: number | null }[] = [
    { value: "details", label: "Details" },
    ...(rights.canManage ? [{ value: "pricing" as const, label: "Pricing" }] : []),
    { value: "curriculum", label: "Curriculum", count: c.sections.reduce((n, s) => n + s.items.length, 0) },
    { value: "questions", label: "Questions" },
    { value: "staff", label: "Staff", count: c.staff.length },
    { value: "learners", label: "Learners" },
  ];
  const raw = url.get("tab") as EditorTab;
  const tab: EditorTab = tabs.some((t) => t.value === raw) ? raw : "details";
  const go = (next: { tab?: EditorTab; item?: string | null }) => url.set({ tab: next.tab ?? tab, item: next.item ?? null });

  return (
    <AdminPage
      testId="course-editor"
      back={{ href: "/admin/courses", label: "Courses" }}
      title={c.title}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <CourseStatusBadge status={c.status} />
          <span>/{c.slug}</span>
          {c.myRole ? <span>· You are {c.myRole === "OWNER" ? "the owner" : c.myRole === "EDITOR" ? "an editor" : "a grader"}</span> : null}
        </span>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <UnderlineTabs tabs={tabs} value={tab} onChange={(v) => go({ tab: v })} label="Course editor" className="mb-6" />
          {rights.readOnlyReason ? <ReadOnlyNote>{rights.readOnlyReason}</ReadOnlyNote> : null}
          <TabBody course={c} tab={tab} openItem={url.get("item") || null} onOpenItem={(item) => go({ tab: "curriculum", item })} />
        </div>
        <PublishPanel course={c} rights={rights} onFix={go} />
      </div>
    </AdminPage>
  );
}

function TabBody({ course, tab, openItem, onOpenItem }: { course: AdminCourse; tab: EditorTab; openItem: string | null; onOpenItem: (id: string | null) => void }) {
  const viewer = useAdminSession();
  const rights = courseRights(course, viewer);
  switch (tab) {
    case "pricing":
      return <PricingTab course={course} rights={rights} />;
    case "curriculum":
      return <CurriculumBuilder course={course} rights={rights} openItemId={openItem} onOpenItem={onOpenItem} />;
    case "questions":
      return <QuestionsTab course={course} rights={rights} />;
    case "staff":
      return <StaffTab course={course} rights={rights} />;
    case "learners":
      return <LearnersTab course={course} />;
    default:
      return <DetailsTab key={course.id} course={course} rights={rights} />;
  }
}

function EditorSkeleton() {
  return (
    <AdminPage title={<Skeleton className="h-8 w-72" />} back={{ href: "/admin/courses", label: "Courses" }}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]" aria-busy>
        <div className="space-y-5">
          <Skeleton className="h-8 w-full max-w-lg" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </AdminPage>
  );
}
