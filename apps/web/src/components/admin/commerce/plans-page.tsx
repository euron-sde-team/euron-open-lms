"use client";

import { useMemo } from "react";
import { Package, Plus } from "lucide-react";
import { Button } from "@open-lms/ui";
import type { AdminBundle, AdminPlan } from "@open-lms/types";
import { api } from "@/lib/api";
import { usePagedList } from "@/lib/hooks/queries";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { CourseCover } from "@/components/course/course-cover";
import { AdminPage, DataTable, FilterBar, pagedTable, useUrlState, type Column } from "../shell";
import { BundleSheet } from "./bundle-sheet";
import { CatalogStatusBadge, usePlansList } from "./commerce-bits";
import { planPriceSummary } from "./commerce-model";
import { PlanSheet } from "./plan-sheet";

type View = "plans" | "bundles";
const VIEWS: { value: View; label: string }[] = [
  { value: "plans", label: "Plans" },
  { value: "bundles", label: "Bundles" },
];

const n = (v: number) => new Intl.NumberFormat().format(v);

export function AdminPlans() {
  const url = useUrlState();
  const view: View = url.get("view") === "bundles" ? "bundles" : "plans";
  const open = url.get("open") || null;

  return (
    <AdminPage
      title="Plans and bundles"
      description={view === "plans" ? "Subscription plans: what they include and what they cost each month or year." : "Groups of courses sold together for one price."}
      actions={
        <Button onClick={() => url.set({ open: "new" })} data-testid={view === "plans" ? "plan-new" : "bundle-new"}>
          <Plus /> {view === "plans" ? "New plan" : "New bundle"}
        </Button>
      }
      testId="admin-plans"
    >
      {view === "plans" ? <PlansTable open={open} onTab={(v) => url.set({ view: v === "plans" ? null : v, open: null, q: null })} /> : <BundlesTable open={open} onTab={(v) => url.set({ view: v === "plans" ? null : v, open: null, q: null })} />}
    </AdminPage>
  );
}

function PlansTable({ open, onTab }: { open: string | null; onTab: (v: View) => void }) {
  const url = useUrlState();
  const q = usePlansList();
  const rows = useMemo(() => [...(q.data ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)), [q.data]);
  const columns = useMemo<Column<AdminPlan>[]>(
    () => [
      {
        key: "name",
        header: "Plan",
        sortValue: (r) => r.name,
        cell: (r) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{r.name}</p>
            <p className="truncate text-[12.5px] text-muted-foreground">/{r.slug}</p>
          </div>
        ),
      },
      { key: "status", header: "Status", cell: (r) => <CatalogStatusBadge status={r.status} /> },
      { key: "prices", header: "Prices", hideBelow: "md", cell: (r) => planPriceSummary(r.prices) || <span className="text-subtle-foreground">No prices</span> },
      { key: "trial", header: "Trial", hideBelow: "lg", cell: (r) => (r.trialDays ? `${r.trialDays} days` : <span className="text-subtle-foreground">None</span>) },
      { key: "subs", header: "Active subscribers", align: "right", sortValue: (r) => r.activeSubscribers, cell: (r) => n(r.activeSubscribers) },
      { key: "position", header: "Order", align: "right", hideBelow: "lg", sortValue: (r) => r.position, cell: (r) => r.position },
    ],
    [],
  );
  const plan = open && open !== "new" ? rows.find((p) => p.id === open) ?? null : null;

  return (
    <>
      <FilterBar className="mb-4" tabs={VIEWS} tab="plans" onTabChange={onTab} tabsLabel="Plans or bundles" testId="plans-view" />
      <DataTable
        caption="Plans"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowClick={(r) => url.set({ open: r.id })}
        selectedKey={open}
        rowTestId={(r) => `plan-row-${r.slug}`}
        empty={{ icon: <Package />, title: "No plans yet", description: "A plan gives subscribers every course marked as included in subscriptions.", action: <Button variant="outline" onClick={() => url.set({ open: "new" })}>Create a plan</Button> }}
        testId="plans-table"
      />
      <PlanSheet open={open === "new" || !!plan} plan={plan} onClose={() => url.set({ open: null })} onCreated={(p) => url.set({ open: p.id })} />
    </>
  );
}

function BundlesTable({ open, onTab }: { open: string | null; onTab: (v: View) => void }) {
  const url = useUrlState();
  const q = url.get("q");
  const list = usePagedList<AdminBundle>({
    queryKey: qk.admin.list("bundles", { q }),
    fetchPage: (cursor) => api().adminCommerce.bundles({ q: q || undefined, cursor, limit: 30 }),
  });
  const columns = useMemo<Column<AdminBundle>[]>(
    () => [
      {
        key: "title",
        header: "Bundle",
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-16 shrink-0 overflow-hidden rounded-md">
              <CourseCover src={r.cover?.thumbUrl ?? r.cover?.url ?? null} title={r.title} seed={r.slug} size="sm" rounded="none" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{r.title}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">/{r.slug}</p>
            </div>
          </div>
        ),
        className: "min-w-[240px]",
      },
      { key: "status", header: "Status", cell: (r) => <CatalogStatusBadge status={r.status} /> },
      { key: "courses", header: "Courses", align: "right", cell: (r) => r.courseIds.length },
      {
        key: "prices",
        header: "Prices",
        align: "right",
        hideBelow: "md",
        cell: (r) => {
          const ps = r.prices.filter((p) => p.active && !p.interval);
          return ps.length ? ps.map((p) => formatMoney(p.amount, { compact: true })).join(" · ") : <span className="text-subtle-foreground">No prices</span>;
        },
      },
    ],
    [],
  );

  return (
    <>
      <FilterBar
        className="mb-4"
        tabs={VIEWS}
        tab="bundles"
        onTabChange={onTab}
        tabsLabel="Plans or bundles"
        search={q}
        onSearchChange={(v) => url.set({ q: v })}
        searchPlaceholder="Search bundles"
        testId="bundles-view"
      />
      <DataTable
        caption="Bundles"
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={(r) => url.set({ open: r.id })}
        selectedKey={open}
        rowTestId={(r) => `bundle-row-${r.slug}`}
        empty={{ icon: <Package />, title: q ? "No bundles match" : "No bundles yet", description: q ? "Try another title." : "Sell several courses together, usually for less than buying them one by one." }}
        testId="bundles-table"
        {...pagedTable(list)}
      />
      <BundleSheet id={open} onClose={() => url.set({ open: null })} onCreated={(b) => url.set({ open: b.id })} />
    </>
  );
}
