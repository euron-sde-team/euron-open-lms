"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, ExternalLink } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Button, toast } from "@open-lms/ui";
import type { AdminCourse } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { TimeAgo } from "@/components/common/time-ago";
import { CourseStatusBadge, courseKey, useSetCourse, type CourseRights } from "./course-bits";
import type { EditorTab } from "./course-editor";

type Check = AdminCourse["publishChecklist"][number];

/** Where each checklist code is fixed. */
export function fixTarget(c: Check): { tab: EditorTab; item?: string; label: string } {
  switch (c.code) {
    case "NO_COVER":
    case "NO_DESCRIPTION":
      return { tab: "details", label: "Open details" };
    case "NO_PRICE":
      return { tab: "pricing", label: "Set prices" };
    case "VIDEO_NOT_READY":
    case "EMPTY_QUIZ":
      return c.itemId ? { tab: "curriculum", item: c.itemId, label: "Open item" } : { tab: "curriculum", label: "Open curriculum" };
    default:
      return { tab: "curriculum", label: "Add content" };
  }
}

export function PublishPanel({ course, rights, onFix }: { course: AdminCourse; rights: CourseRights; onFix: (t: { tab: EditorTab; item?: string | null }) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const setCourse = useSetCourse(course.id);
  const [checklist, setChecklist] = useState<Check[] | null>(null);
  const [confirm, setConfirm] = useState<"archive" | "unpublish" | "delete" | null>(null);
  const list = checklist ?? course.publishChecklist;
  // A fresh course from the server carries the current checklist.
  useEffect(() => setChecklist(null), [course.publishChecklist]);

  const done = (c: AdminCourse, title: string) => {
    setCourse(c);
    setChecklist(null);
    void qc.invalidateQueries({ queryKey: qk.admin.list("courses") });
    toast.success({ title });
  };
  const publish = useMutation({
    mutationFn: () => api().authoring.courses.publish(course.id),
    meta: { silent: true },
    onSuccess: (c) => done(c, "Published. Learners can find it in the catalog now."),
    onError: (e) => {
      if (isApiError(e) && e.code === "PUBLISH_BLOCKED") {
        const d = e.details as { checklist?: Check[] } | undefined;
        if (d?.checklist) setChecklist(d.checklist);
        toast.error({ title: "Finish the checklist before publishing." });
      } else toast.error({ title: errorMessage(e) });
    },
  });
  const unpublish = useMutation({ mutationFn: () => api().authoring.courses.unpublish(course.id), onSuccess: (c) => done(c, "Unpublished. It is a draft again.") });
  const archive = useMutation({ mutationFn: () => api().authoring.courses.archive(course.id), onSuccess: (c) => done(c, "Archived. Enrolled learners keep their access.") });
  const remove = useMutation({
    mutationFn: () => api().authoring.courses.remove(course.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: courseKey(course.id) });
      void qc.invalidateQueries({ queryKey: qk.admin.list("courses") });
      toast.success({ title: "Course deleted." });
      router.push("/admin/courses");
    },
  });

  const canChangeStatus = rights.canManage;

  return (
    <aside aria-labelledby="publish-title" className="lg:sticky lg:top-6 lg:self-start lg:border-l lg:border-border lg:pl-6" data-testid="publish-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 id="publish-title" className="font-display text-[18px] font-semibold tracking-[-0.015em]">
          Status
        </h2>
        <CourseStatusBadge status={course.status} />
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {course.status === "PUBLISHED" && course.publishedAt ? (
          <>
            Published <TimeAgo value={course.publishedAt} />
          </>
        ) : course.status === "ARCHIVED" ? (
          "Hidden from the catalog. Enrolled learners keep access."
        ) : (
          "Only course staff can see a draft."
        )}
        {" · "}saved <TimeAgo value={course.updatedAt} />
      </p>

      {course.status !== "PUBLISHED" ? (
        <div className="mt-5">
          <h3 className="text-[13px] font-semibold">Before publishing</h3>
          {list.length ? (
            <ul className="mt-2 divide-y divide-border border-y border-border" data-testid="publish-checklist" aria-live="polite">
              {list.map((c, i) => {
                const fix = fixTarget(c);
                return (
                  <li key={`${c.code}-${c.itemId ?? i}`} className="flex items-start gap-2 py-2.5 text-[13.5px]" data-testid={`check-${c.code}`}>
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p>{c.message}</p>
                      <button type="button" className="mt-0.5 text-[13px] font-medium text-link hover:underline" onClick={() => onFix({ tab: fix.tab, item: fix.item ?? null })} data-testid={`fix-${c.code}`}>
                        {fix.label}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-[13.5px] text-muted-foreground" data-testid="publish-ready">
              <Check className="size-4 text-success" aria-hidden /> Everything needed is in place.
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2">
        {course.status !== "PUBLISHED" ? (
          <Button block onClick={() => publish.mutate()} loading={publish.isPending} disabled={!canChangeStatus} data-testid="course-publish">
            {course.status === "ARCHIVED" ? "Publish again" : "Publish"}
          </Button>
        ) : (
          <Button block variant="outline" onClick={() => setConfirm("unpublish")} disabled={!canChangeStatus} data-testid="course-unpublish">
            Unpublish
          </Button>
        )}
        {course.status !== "PUBLISHED" ? null : (
          <Button asChild block variant="ghost">
            <Link href={`/courses/${course.slug}`} target="_blank">
              View in catalog <ExternalLink />
            </Link>
          </Button>
        )}
        {course.status !== "ARCHIVED" ? (
          <Button block variant="ghost" onClick={() => setConfirm("archive")} disabled={!canChangeStatus} data-testid="course-archive">
            Archive
          </Button>
        ) : null}
        {course.status === "DRAFT" && canChangeStatus ? (
          <Button block variant="danger-ghost" onClick={() => setConfirm("delete")} data-testid="course-delete">
            Delete draft
          </Button>
        ) : null}
        {!canChangeStatus ? <p className="text-[12.5px] text-subtle-foreground">{rights.manageReason}</p> : null}
      </div>

      <ConfirmDialog
        open={confirm === "unpublish"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Unpublish "${course.title}"?`}
        description="It leaves the catalog and becomes a draft. Enrolled learners keep their access."
        confirmLabel="Unpublish"
        onConfirm={() => unpublish.mutateAsync()}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Archive "${course.title}"?`}
        description="It leaves the catalog and can not be bought. Enrolled learners keep their access."
        confirmLabel="Archive"
        onConfirm={() => archive.mutateAsync()}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete "${course.title}"?`}
        description="The draft, its curriculum and its question bank are removed for good. Courses with learners can only be archived."
        confirmLabel="Delete course"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </aside>
  );
}
