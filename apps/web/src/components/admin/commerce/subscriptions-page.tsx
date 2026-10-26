"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@open-lms/ui";
import type { AdminSubscriptionRow } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { fullTimestamp } from "@/lib/time";
import { shortDate } from "@/lib/admin-ops";
import { AdminPage, DataTable, FilterBar, pagedTable, useAdminSession, useUrlState, type Column } from "../shell";
import { OrdersViews, SubscriptionStatusBadge } from "./commerce-bits";
import { GATEWAY_LABEL, INTERVAL_SHORT, SUBSCRIPTION_TABS, canMoveMoney, type SubscriptionTab } from "./commerce-model";

const CANCELABLE = new Set(["ACTIVE", "TRIALING", "PAST_DUE", "INCOMPLETE"]);

export function AdminSubscriptions() {
  const url = useUrlState();
  const session = useAdminSession();
  const mover = canMoveMoney(session.role);
  const status = (SUBSCRIPTION_TABS.some((t) => t.value === url.get("status")) ? url.get("status") : "all") as SubscriptionTab;
  const [cancel, setCancel] = useState<AdminSubscriptionRow | null>(null);

  const list = usePagedList<AdminSubscriptionRow>({
    queryKey: qk.admin.list("subscriptions", { status }),
    fetchPage: (cursor) => api().adminCommerce.subscriptions({ status: status === "all" ? undefined : status, cursor, limit: 30 }),
  });

  const columns = useMemo<Column<AdminSubscriptionRow>[]>(
    () => [
      {
        key: "learner",
        header: "Learner",
        cell: (r) => (
          <div className="min-w-0 max-w-[240px]">
            <p className="truncate font-medium text-foreground">{r.user.displayName}</p>
            <p className="truncate text-[12.5px] text-muted-foreground">{r.user.email}</p>
          </div>
        ),
      },
      { key: "plan", header: "Plan", cell: (r) => r.plan.name },
      { key: "price", header: "Price", align: "right", cell: (r) => `${formatMoney(r.price)} / ${INTERVAL_SHORT[r.interval]}`, hideBelow: "md" },
      { key: "status", header: "Status", cell: (r) => <SubscriptionStatusBadge status={r.status} /> },
      {
        key: "period",
        header: "Renews or ends",
        hideBelow: "sm",
        cell: (r) =>
          r.currentPeriodEnd ? (
            <span title={fullTimestamp(r.currentPeriodEnd)} className={cn("whitespace-nowrap", r.cancelAtPeriodEnd && "text-muted-foreground")}>
              {r.cancelAtPeriodEnd || !CANCELABLE.has(r.status) ? "Ends" : "Renews"} {shortDate(r.currentPeriodEnd)}
            </span>
          ) : (
            <span className="text-subtle-foreground">None</span>
          ),
      },
      { key: "gateway", header: "Gateway", cell: (r) => GATEWAY_LABEL[r.gateway], hideBelow: "lg" },
      { key: "since", header: "Since", align: "right", cell: (r) => shortDate(r.createdAt), hideBelow: "lg" },
      ...(mover
        ? [
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              align: "right" as const,
              cell: (r: AdminSubscriptionRow) =>
                CANCELABLE.has(r.status) ? (
                  <Button size="sm" variant="ghost" onClick={() => setCancel(r)} data-testid={`subscription-cancel-${r.id}`}>
                    Cancel
                  </Button>
                ) : null,
            },
          ]
        : []),
    ],
    [mover],
  );

  return (
    <AdminPage title="Orders" description="Every purchase, its payment, refunds and the access it granted." testId="admin-subscriptions">
      <OrdersViews value="subscriptions" />
      <FilterBar className="mb-4" tabs={SUBSCRIPTION_TABS} tab={status} onTabChange={(v) => url.set({ status: v === "all" ? null : v })} tabsLabel="Subscription status" testId="subscriptions-filter" />
      {!mover ? <p className="mb-4 text-[13px] text-muted-foreground">Cancelling a subscription is for finance staff and administrators.</p> : null}
      <DataTable
        caption="Subscriptions"
        columns={columns}
        rowKey={(r) => r.id}
        rowTestId={(r) => `subscription-row-${r.id}`}
        empty={{ icon: <Repeat />, title: status !== "all" ? "No subscriptions with this status" : "No subscriptions yet", description: status === "all" ? "They show up here when learners subscribe to a plan." : undefined }}
        testId="subscriptions-table"
        {...pagedTable(list)}
      />
      <CancelDialog sub={cancel} onClose={() => setCancel(null)} />
    </AdminPage>
  );
}

function CancelDialog({ sub, onClose }: { sub: AdminSubscriptionRow | null; onClose: () => void }) {
  const id = useId();
  const qc = useQueryClient();
  const [when, setWhen] = useState<"end" | "now">("end");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (sub) {
      setWhen(sub.cancelAtPeriodEnd || !sub.currentPeriodEnd ? "now" : "end");
      setError(null);
    }
  }, [sub]);

  const m = useMutation({
    mutationFn: (atPeriodEnd: boolean) => api().adminCommerce.cancelSubscription(sub!.id, atPeriodEnd),
    meta: { silent: true },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: qk.admin.list("subscriptions") });
      toast.success({ title: row.cancelAtPeriodEnd && row.currentPeriodEnd ? `Cancelled. It ends ${shortDate(row.currentPeriodEnd)}.` : "Subscription cancelled." });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const options: { value: "end" | "now"; label: string; help: string; disabled?: boolean }[] = [
    {
      value: "end",
      label: sub?.currentPeriodEnd ? `At the end of the period, ${shortDate(sub.currentPeriodEnd)}` : "At the end of the period",
      help: "No more charges. The learner keeps access until then.",
      disabled: !sub?.currentPeriodEnd || sub.cancelAtPeriodEnd,
    },
    { value: "now", label: "Now", help: "Access through the plan ends right away. Nothing is refunded automatically." },
  ];

  return (
    <Dialog open={!!sub} onOpenChange={(o) => !o && !m.isPending && onClose()}>
      <DialogContent size="sm" data-testid="subscription-cancel-dialog">
        <DialogHeader>
          <DialogTitle>Cancel {sub?.user.displayName}&apos;s {sub?.plan.name} subscription?</DialogTitle>
          <DialogDescription>{sub?.cancelAtPeriodEnd ? "It is already set to end at the period end. You can end it now instead." : "Choose when it ends."}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <fieldset className="divide-y divide-border">
            <legend className="sr-only">When to cancel</legend>
            {options.map((o) => (
              <label key={o.value} htmlFor={`${id}-${o.value}`} className={cn("flex cursor-pointer items-start gap-3 py-3 first:pt-0", o.disabled && "cursor-not-allowed opacity-50")}>
                <input
                  id={`${id}-${o.value}`}
                  type="radio"
                  name={`${id}-when`}
                  value={o.value}
                  checked={when === o.value}
                  disabled={o.disabled}
                  onChange={() => setWhen(o.value)}
                  className="mt-1 size-4 accent-primary"
                  data-testid={`subscription-cancel-${o.value}`}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">{o.label}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{o.help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p role="alert" className="mt-3 text-[13px] font-medium text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={m.isPending}>
            Keep it
          </Button>
          <Button variant="danger" loading={m.isPending} onClick={() => m.mutate(when === "end")} data-testid="subscription-cancel-confirm">
            {when === "end" ? "Cancel at period end" : "Cancel now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
