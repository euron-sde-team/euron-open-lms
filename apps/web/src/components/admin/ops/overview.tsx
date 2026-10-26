"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Button, Input, toast } from "@open-lms/ui";
import type { AdminStats } from "@open-lms/types";
import { api } from "@/lib/api";
import { presetRange, rangeDays } from "@/lib/admin";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { AdminPage, AdminSection, Chart, DataTable, StatLine, useAdminSession, useUrlState, type Column, type StatItem } from "../shell";

type Preset = "7" | "30" | "90" | "custom";
type Metric = "enrollments" | "signups" | "completions" | "orders";
const METRICS: { value: Metric; label: string }[] = [
  { value: "enrollments", label: "Enrollments" },
  { value: "signups", label: "Sign-ups" },
  { value: "completions", label: "Completions" },
  { value: "orders", label: "Paid orders" },
];

/** The range the URL asks for; a broken custom range falls back to the last 30 days. */
export function resolveRange(preset: string, from: string, to: string, now = new Date()): { preset: Preset; from: string; to: string; error: string | null } {
  if (preset === "custom") {
    const days = rangeDays(from, to);
    if (!days) return { preset: "custom", ...presetRange(30, now), error: "Pick a start date on or before the end date." };
    if (days > 366) return { preset: "custom", ...presetRange(30, now), error: "A range can be at most 366 days." };
    return { preset: "custom", from, to, error: null };
  }
  const p: Preset = preset === "7" || preset === "90" ? preset : "30";
  return { preset: p, ...presetRange(Number(p), now), error: null };
}

const n = (v: number) => new Intl.NumberFormat().format(v);

export function AdminOverview() {
  const session = useAdminSession();
  const url = useUrlState();
  const range = resolveRange(url.get("range") || "30", url.get("from"), url.get("to"));
  const [metric, setMetric] = useState<Metric>("enrollments");
  const [exporting, setExporting] = useState(false);
  const q = useQuery({ queryKey: qk.admin.list("stats", { from: range.from, to: range.to }), queryFn: () => api().admin.stats({ from: range.from, to: range.to }), placeholderData: (p) => p });
  const s = q.data;

  const exportCsv = async () => {
    setExporting(true);
    try {
      saveBlob(await api().admin.statsCsv({ from: range.from, to: range.to }), `stats-${range.from}-to-${range.to}.csv`);
    } catch (e) {
      toast.error({ title: errorMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminPage
      title="Overview"
      description={session.isInstructor ? "How your courses are doing." : s ? `All figures in ${s.range.timezone}.` : "How the academy is doing."}
      actions={
        <Button variant="outline" onClick={() => void exportCsv()} loading={exporting} data-testid="overview-export">
          <Download /> Export CSV
        </Button>
      }
      filters={<RangePicker preset={range.preset} from={range.from} to={range.to} error={range.error} onChange={(p) => url.set(p)} />}
      testId="admin-overview"
    >
      {q.isError && !s ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-10">
          <StatLine loading={!s} size="lg" items={totalsItems(s)} testId="overview-totals" />
          <Revenue stats={s} />
          <AdminSection title="Activity by day" id="activity">
            <UnderlineTabs tabs={METRICS} value={metric} onChange={setMetric} label="Metric" size="sm" className="mb-4" />
            {s ? (
              <Chart data={s.daily} series={[{ key: metric, label: METRICS.find((m) => m.value === metric)!.label }]} type={s.daily.length > 45 ? "line" : "bar"} title={`${METRICS.find((m) => m.value === metric)!.label} per day`} testId="overview-chart" />
            ) : (
              <div className="h-[240px] animate-shimmer rounded-md bg-muted" aria-hidden />
            )}
          </AdminSection>
          <TopCourses stats={s} loading={!s} />
        </div>
      )}
    </AdminPage>
  );
}

function totalsItems(s: AdminStats | undefined): StatItem[] {
  const t = s?.totals;
  return [
    { label: "Learners", value: t ? n(t.learners) : "", hint: t ? `${n(t.newLearners)} new` : undefined, testId: "stat-learners" },
    { label: "Active learners", value: t ? n(t.activeLearners) : "" },
    { label: "Enrollments", value: t ? n(t.newEnrollments) : "", hint: t ? `${n(t.enrollments)} in all` : undefined },
    { label: "Completions", value: t ? n(t.completions) : "" },
    { label: "Certificates", value: t ? n(t.certificates) : "" },
    { label: "Waiting for grading", value: t ? n(t.pendingGrading) : "", href: "/admin/grading" },
    ...(t && t.openReports > 0 ? [{ label: "Open reports", value: n(t.openReports), href: "/admin/moderation" }] : []),
  ];
}

function Revenue({ stats }: { stats: AdminStats | undefined }) {
  if (!stats) return null;
  if (!stats.revenue.length && !stats.mrr.length) return null;
  return (
    <AdminSection title="Revenue" description="Each currency on its own: amounts in different currencies are never added together." id="revenue">
      {stats.revenue.length ? (
        <StatLine
          testId="overview-revenue"
          items={stats.revenue.map((r) => ({
            label: `Net in ${r.currency}`,
            value: formatMoney({ amountMinor: r.net, currency: r.currency }),
            hint: `${formatMoney({ amountMinor: r.gross, currency: r.currency })} gross${r.refunded ? `, ${formatMoney({ amountMinor: r.refunded, currency: r.currency })} refunded` : ""} · ${n(r.orders)} ${r.orders === 1 ? "order" : "orders"}`,
          }))}
        />
      ) : (
        <p className="text-[14px] text-muted-foreground">No paid orders in this range.</p>
      )}
      {stats.mrr.length ? (
        <StatLine
          className="mt-6"
          testId="overview-mrr"
          items={stats.mrr.map((m) => ({
            label: `Monthly recurring in ${m.currency}`,
            value: formatMoney({ amountMinor: m.amountMinor, currency: m.currency }),
            hint: `${n(m.subscribers)} ${m.subscribers === 1 ? "subscriber" : "subscribers"}`,
          }))}
        />
      ) : null}
      {stats.totals.refunds ? <p className="mt-4 text-[13px] text-muted-foreground">{n(stats.totals.refunds)} refunds in this range.</p> : null}
    </AdminSection>
  );
}

type TopRow = AdminStats["topCourses"][number];

function TopCourses({ stats, loading }: { stats: AdminStats | undefined; loading: boolean }) {
  const columns = useMemo<Column<TopRow>[]>(
    () => [
      {
        key: "title",
        header: "Course",
        cell: (r) => (
          <Link href={`/admin/courses/${r.id}`} className="font-medium text-foreground hover:text-link hover:underline">
            {r.title}
          </Link>
        ),
        sortValue: (r) => r.title,
      },
      { key: "enrollments", header: "Enrollments", align: "right", cell: (r) => n(r.enrollments), sortValue: (r) => r.enrollments },
      { key: "completions", header: "Completions", align: "right", cell: (r) => n(r.completions), sortValue: (r) => r.completions, hideBelow: "sm" },
      { key: "rate", header: "Completion rate", align: "right", cell: (r) => (r.enrollments ? `${Math.round((r.completions / r.enrollments) * 100)}%` : "n/a"), sortValue: (r) => (r.enrollments ? r.completions / r.enrollments : null), hideBelow: "md" },
      { key: "rating", header: "Rating", align: "right", cell: (r) => (r.rating === null ? "n/a" : r.rating.toFixed(1)), sortValue: (r) => r.rating, hideBelow: "sm" },
    ],
    [],
  );
  return (
    <AdminSection title="Top courses" description="By enrollments in this range." id="top-courses">
      <DataTable
        caption="Top courses"
        rows={stats?.topCourses ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        skeletonRows={5}
        empty={{ title: "No enrollments in this range" }}
        testId="overview-top-courses"
      />
    </AdminSection>
  );
}

function RangePicker({ preset, from, to, error, onChange }: { preset: Preset; from: string; to: string; error: string | null; onChange: (p: Record<string, string | null>) => void }) {
  const [draft, setDraft] = useState({ from, to });
  const tabs: { value: Preset; label: string }[] = [
    { value: "7", label: "Last 7 days" },
    { value: "30", label: "Last 30 days" },
    { value: "90", label: "Last 90 days" },
    { value: "custom", label: "Custom" },
  ];
  return (
    <div className="border-b border-border">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <UnderlineTabs
          tabs={tabs}
          value={preset}
          label="Date range"
          className="border-b-0"
          onChange={(v) => {
            if (v === "custom") {
              setDraft({ from, to });
              onChange({ range: "custom", from, to });
            } else onChange({ range: v === "30" ? null : v, from: null, to: null });
          }}
        />
        {preset === "custom" ? (
          <form
            className="flex flex-wrap items-center gap-2 pb-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              onChange({ range: "custom", from: draft.from, to: draft.to });
            }}
          >
            <label className="sr-only" htmlFor="range-from">From</label>
            <Input id="range-from" type="date" value={draft.from} max={draft.to} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} className="h-9 w-[150px]" data-testid="range-from" />
            <span className="text-[13px] text-muted-foreground">to</span>
            <label className="sr-only" htmlFor="range-to">To</label>
            <Input id="range-to" type="date" value={draft.to} min={draft.from} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className="h-9 w-[150px]" data-testid="range-to" />
            <Button type="submit" size="sm" variant="outline" data-testid="range-apply">
              Apply
            </Button>
          </form>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="pb-2 text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
