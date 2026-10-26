"use client";

import { useMemo } from "react";
import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Plus, Ticket } from "lucide-react";
import { Button, Switch, toast } from "@open-lms/ui";
import type { AdminCoupon, Page } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { qk } from "@/lib/query-keys";
import { shortDate } from "@/lib/admin-ops";
import { AdminPage, DataTable, FilterBar, pagedTable, useUrlState, type Column } from "../shell";
import { Mono } from "./commerce-bits";
import { couponScopeLabel, couponState, couponValueLabel, redemptionsLabel } from "./commerce-model";
import { CouponSheet } from "./coupon-sheet";

const STATE_LABEL = { LIVE: "Live", OFF: "Off", SCHEDULED: "Scheduled", EXPIRED: "Expired", USED_UP: "Used up" } as const;

type Pages = InfiniteData<Page<AdminCoupon>, string | undefined>;

/** Replace one coupon in every cached coupons list. */
export function useApplyCoupon() {
  const qc = useQueryClient();
  return (c: AdminCoupon) =>
    qc.setQueriesData<Pages>({ queryKey: qk.admin.list("coupons") }, (old) =>
      old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === c.id ? c : x)) })) } : old,
    );
}

export function AdminCoupons() {
  const url = useUrlState();
  const q = url.get("q");
  const open = url.get("open") || null;
  const qc = useQueryClient();
  const apply = useApplyCoupon();
  const list = usePagedList<AdminCoupon>({
    queryKey: qk.admin.list("coupons", { q }),
    fetchPage: (cursor) => api().adminCommerce.coupons({ q: q || undefined, cursor, limit: 30 }),
  });

  const toggle = useMutation({
    mutationFn: (c: AdminCoupon) => api().adminCommerce.updateCoupon(c.id, { active: !c.active }),
    meta: { silent: true },
    onMutate: (c) => {
      apply({ ...c, active: !c.active });
      return { before: c };
    },
    onSuccess: (c) => {
      apply(c);
      toast.success({ title: c.active ? `${c.code} is on.` : `${c.code} is off.` });
    },
    onError: (e, _c, ctx) => {
      if (ctx) apply(ctx.before);
      toast.error({ title: errorMessage(e) });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.admin.list("coupons") }),
  });

  const columns = useMemo<Column<AdminCoupon>[]>(
    () => [
      {
        key: "code",
        header: "Code",
        cell: (r) => (
          <div className="min-w-0 max-w-[220px]">
            <Mono className="font-semibold text-foreground">{r.code}</Mono>
            {r.description ? <p className="truncate text-[12.5px] text-muted-foreground">{r.description}</p> : null}
          </div>
        ),
      },
      { key: "value", header: "Discount", cell: (r) => <span className="whitespace-nowrap">{couponValueLabel(r)}</span> },
      { key: "scope", header: "Applies to", hideBelow: "md", cell: (r) => <span className="line-clamp-2 max-w-[240px]" title={r.scope === "SPECIFIC" ? r.targets.map((t) => t.title).join(", ") : undefined}>{couponScopeLabel(r)}</span> },
      { key: "used", header: "Used", align: "right", hideBelow: "sm", sortValue: (r) => r.redemptionCount, cell: (r) => redemptionsLabel(r) },
      { key: "expires", header: "Expires", hideBelow: "lg", cell: (r) => (r.expiresAt ? shortDate(r.expiresAt) : <span className="text-subtle-foreground">No end</span>) },
      {
        key: "active",
        header: "Active",
        align: "right",
        cell: (r) => {
          const state = couponState(r);
          return (
            <span className="inline-flex items-center justify-end gap-2.5">
              <span className="text-[12.5px] text-muted-foreground">{STATE_LABEL[state]}</span>
              <Switch
                checked={r.active}
                onCheckedChange={() => toggle.mutate(r)}
                aria-label={`${r.code} active`}
                disabled={toggle.isPending && toggle.variables?.id === r.id}
                data-testid={`coupon-active-${r.code}`}
              />
            </span>
          );
        },
      },
    ],
    [toggle],
  );

  const coupon = open && open !== "new" ? list.items.find((c) => c.id === open) ?? null : null;

  return (
    <AdminPage
      title="Coupons"
      description="Discount codes learners enter at checkout."
      actions={
        <Button onClick={() => url.set({ open: "new" })} data-testid="coupon-new">
          <Plus /> New coupon
        </Button>
      }
      filters={<FilterBar search={q} onSearchChange={(v) => url.set({ q: v })} searchPlaceholder="Search by code" testId="coupons-filter" />}
      testId="admin-coupons"
    >
      <DataTable
        caption="Coupons"
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={(r) => url.set({ open: r.id })}
        selectedKey={open}
        rowTestId={(r) => `coupon-row-${r.code}`}
        empty={{ icon: <Ticket />, title: q ? "No coupons match" : "No coupons yet", description: q ? "Try another code." : "Create a code for a launch, a partner or a class." }}
        testId="coupons-table"
        {...pagedTable(list)}
      />
      <CouponSheet
        open={open === "new" || !!coupon || (!!open && list.isPending)}
        coupon={coupon}
        loading={!!open && open !== "new" && list.isPending}
        onClose={() => url.set({ open: null })}
        onSaved={(c, created) => {
          if (created) void qc.invalidateQueries({ queryKey: qk.admin.list("coupons") });
          else apply(c);
          url.set({ open: null });
        }}
      />
    </AdminPage>
  );
}
