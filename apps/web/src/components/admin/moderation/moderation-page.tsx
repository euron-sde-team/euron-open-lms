"use client";

import { useState } from "react";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Badge, Button, toast } from "@open-lms/ui";
import type { AdminReport, Page, ReportReason, ReportTarget } from "@open-lms/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { TimeAgo } from "@/components/common/time-ago";
import { AdminPage } from "@/components/admin/shell/admin-page";
import { DataTable, pagedTable, type Column } from "@/components/admin/shell/data-table";
import { FilterBar } from "@/components/admin/shell/filter-bar";
import { ReasonDialog } from "@/components/admin/shell/reason-dialog";
import { useUrlState } from "@/components/admin/shell/url-state";

type Tab = "OPEN" | "RESOLVED";
type Action = "HIDE" | "RESTORE" | "DISMISS";

const REASON: Record<ReportReason, string> = { SPAM: "Spam", HARASSMENT: "Harassment", OFF_TOPIC: "Off topic", SPOILER: "Spoiler", INAPPROPRIATE: "Inappropriate", OTHER: "Other" };
const TARGET: Record<ReportTarget, string> = { REVIEW: "Review", QA_THREAD: "Question", QA_REPLY: "Answer" };
const ACTION_COPY: Record<Action, { title: string; description: string; confirm: string; done: string }> = {
  HIDE: { title: "Hide this content?", description: "Learners stop seeing it. A hidden review no longer counts in the course rating. You can restore it later.", confirm: "Hide", done: "Hidden. The report is resolved." },
  RESTORE: { title: "Restore this content?", description: "It shows again where it was posted.", confirm: "Restore", done: "Restored." },
  DISMISS: { title: "Dismiss this report?", description: "The content stays as it is and the report is closed.", confirm: "Dismiss", done: "Report dismissed." },
};

export function ModerationPage() {
  const qc = useQueryClient();
  const url = useUrlState();
  const tab: Tab = url.get("status") === "RESOLVED" ? "RESOLVED" : "OPEN";
  const [pending, setPending] = useState<{ report: AdminReport; action: Action } | null>(null);
  const listKey = qk.admin.list("moderation", { status: tab });
  const list = usePagedList<AdminReport>({ queryKey: listKey, fetchPage: (cursor) => api().moderation.reports({ status: tab, cursor }) });

  const resolve = useMutation({
    mutationFn: (v: { id: string; action: Action; note: string | null }) => api().moderation.resolve(v.id, { action: v.action, note: v.note }),
    onSuccess: (r, v) => {
      // Leave the open tab at once; the resolved tab and other reports on the same target refetch.
      if (tab === "OPEN") {
        qc.setQueryData<InfiniteData<Page<AdminReport>>>(listKey, (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== r.id) })) } : d));
      } else {
        qc.setQueryData<InfiniteData<Page<AdminReport>>>(listKey, (d) => (d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === r.id ? r : x)) })) } : d));
      }
      void qc.invalidateQueries({ queryKey: qk.admin.area("moderation") });
      toast.success({ title: ACTION_COPY[v.action].done });
    },
  });

  const actions = (r: AdminReport) => {
    const status = r.target?.status;
    const items: Action[] = [];
    if (status === "PUBLISHED") items.push("HIDE");
    if (status === "HIDDEN") items.push("RESTORE");
    if (r.status === "OPEN") items.push("DISMISS");
    return (
      <div className="flex justify-end gap-1">
        {items.map((a) => (
          <Button key={a} size="sm" variant={a === "HIDE" ? "outline" : "ghost"} onClick={() => setPending({ report: r, action: a })} data-testid={`report-${a.toLowerCase()}`}>
            {ACTION_COPY[a].confirm}
          </Button>
        ))}
      </div>
    );
  };

  const columns: Column<AdminReport>[] = [
    {
      key: "target",
      header: "Reported content",
      cell: (r) => (
        <div className="min-w-[260px] max-w-[520px]">
          <p className="text-[12.5px] text-muted-foreground">
            {TARGET[r.targetType]}
            {r.target?.author ? ` by ${r.target.author.displayName}` : ""}
            {r.course ? ` · ${r.course.title}` : ""}
            {r.target?.rating ? ` · ${r.target.rating} stars` : ""}
            {r.target && r.target.status !== "PUBLISHED" ? <span className="font-medium text-foreground"> · {r.target.status === "HIDDEN" ? "Hidden" : "Deleted"}</span> : null}
          </p>
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[14px]">{r.target?.excerpt ?? <span className="text-subtle-foreground">The content is gone.</span>}</p>
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (r) => (
        <div className="min-w-[120px]">
          <p className="font-medium">{REASON[r.reason]}</p>
          {r.note ? <p className="line-clamp-2 text-[12.5px] text-muted-foreground">{r.note}</p> : null}
        </div>
      ),
    },
    {
      key: "reporter",
      header: "Reporter",
      hideBelow: "md",
      cell: (r) => (
        <div>
          <p className="text-[13.5px]">{r.reporter.displayName}</p>
          <p className="text-[12.5px] text-muted-foreground">
            <TimeAgo value={r.createdAt} />
            {r.otherReports ? ` · ${r.otherReports} other ${r.otherReports === 1 ? "report" : "reports"}` : ""}
          </p>
        </div>
      ),
    },
    ...(tab === "RESOLVED"
      ? [
          {
            key: "resolution",
            header: "Outcome",
            hideBelow: "sm" as const,
            cell: (r: AdminReport) => (
              <div className="min-w-[120px]">
                <Badge tone="neutral">{r.resolution ?? "Resolved"}</Badge>
              </div>
            ),
          },
        ]
      : []),
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", cell: actions },
  ];

  return (
    <AdminPage
      title="Moderation"
      description="Reports on reviews, questions and answers. Hiding keeps the content for the record; learners stop seeing it."
      testId="admin-moderation"
      filters={
        <FilterBar
          tabs={[
            { value: "OPEN", label: "Open" },
            { value: "RESOLVED", label: "Resolved" },
          ]}
          tab={tab}
          onTabChange={(v) => url.set({ status: v === "OPEN" ? null : v })}
          tabsLabel="Report status"
          testId="moderation-filter"
        />
      }
    >
      <DataTable
        {...pagedTable(list)}
        columns={columns}
        rowKey={(r) => r.id}
        caption="Reports"
        testId="reports-table"
        rowTestId={(r) => `report-row-${r.id}`}
        empty={{ icon: <ShieldCheck />, title: tab === "OPEN" ? "No open reports" : "No resolved reports yet", description: tab === "OPEN" ? "When learners report a review, question or answer, it shows here." : undefined }}
      />
      <ReasonDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? ACTION_COPY[pending.action].title : ""}
        description={pending ? ACTION_COPY[pending.action].description : undefined}
        confirmLabel={pending ? ACTION_COPY[pending.action].confirm : "Confirm"}
        destructive={pending?.action === "HIDE"}
        reason="optional"
        reasonLabel="Note"
        reasonHint="Kept with the report in the audit log."
        onConfirm={async ({ reason }) => {
          if (!pending) return;
          await resolve.mutateAsync({ id: pending.report.id, action: pending.action, note: reason || null });
        }}
        testId="moderation-dialog"
      />
    </AdminPage>
  );
}
