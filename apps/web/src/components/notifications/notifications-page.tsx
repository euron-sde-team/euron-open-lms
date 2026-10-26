"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Skeleton } from "@open-lms/ui";
import type { NotificationCounts } from "@open-lms/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { RequireAuth } from "@/components/common/require-auth";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { Page, PageHeader } from "@/components/shell/layouts";
import { NotificationItem } from "./notification-item";

export function NotificationsPage() {
  return (
    <RequireAuth>
      <Inbox />
    </RequireAuth>
  );
}

function Inbox() {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const qc = useQueryClient();
  const list = usePagedList({
    queryKey: qk.notifications(tab === "unread"),
    fetchPage: (cursor) => api().notifications.list({ cursor, unread: tab === "unread" }),
  });
  const readAll = useMutation({
    mutationFn: () => api().notifications.readAll(),
    onMutate: () => qc.setQueryData<NotificationCounts>(qk.counts, () => ({ notifications: 0 })),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notificationsAll }),
  });
  return (
    <Page width="reading">
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="outline" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending}>
            Mark all as read
          </Button>
        }
      />
      <UnderlineTabs
        label="Filter notifications"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: "All" },
          { value: "unread", label: "Unread" },
        ]}
      />
      <div className="mt-2 divide-y divide-border">
        {list.isPending ? (
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex gap-3 px-3 py-4">
              <Skeleton className="size-5 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))
        ) : list.items.length === 0 ? (
          <EmptyState title={tab === "unread" ? "Nothing unread" : "No notifications yet"} description="Receipts, reviews of your work, certificates and answers to your questions show up here." />
        ) : (
          list.items.map((n) => <NotificationItem key={n.id} n={n} />)
        )}
      </div>
      <div ref={list.sentinelRef} />
    </Page>
  );
}
