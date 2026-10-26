"use client";

import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { flattenPages, nextCursor } from "@open-lms/api-client";
import { Button, CountBadge, IconButton, Popover, PopoverContent, PopoverTrigger, Skeleton } from "@open-lms/ui";
import type { NotificationCounts } from "@open-lms/types";
import { api } from "@/lib/api";
import { useCounts } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { NotificationItem } from "@/components/notifications/notification-item";
import { useState } from "react";

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const count = useCounts().data?.notifications ?? 0;
  const qc = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: qk.notifications(false),
    queryFn: ({ pageParam }) => api().notifications.list({ cursor: pageParam, limit: 10 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: open,
  });
  const items = flattenPages(list.data?.pages).slice(0, 10);

  const readAll = useMutation({
    mutationFn: () => api().notifications.readAll(),
    onMutate: () => {
      qc.setQueryData<NotificationCounts>(qk.counts, (c) => (c ? { ...c, notifications: 0 } : c));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notificationsAll }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span className="relative inline-flex">
          <IconButton label={count ? `Notifications, ${count} unread` : "Notifications"} variant="ghost" size="md" data-testid="notifications-bell">
            <Bell />
          </IconButton>
          <CountBadge count={count} className="absolute -right-1 -top-1" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] p-0" data-testid="notifications-dropdown">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-display text-base font-semibold">Notifications</p>
          <Button variant="link" size="sm" onClick={() => readAll.mutate()} disabled={!count}>
            Mark all as read
          </Button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {list.isPending ? (
            <div className="space-y-3 p-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">You are all caught up.</p>
          ) : (
            items.map((n) => <NotificationItem key={n.id} n={n} compact onNavigate={() => setOpen(false)} />)
          )}
        </div>
        <div className="border-t border-border p-2">
          <Button asChild variant="ghost" block size="sm" onClick={() => setOpen(false)}>
            <Link href="/notifications">See all notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
