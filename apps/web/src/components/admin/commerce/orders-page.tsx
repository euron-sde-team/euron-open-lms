"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Receipt } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select } from "@open-lms/ui";
import type { AdminOrderRow, GatewayName } from "@open-lms/types";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { usePagedList } from "@/lib/hooks/queries";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { fullTimestamp, relativeTime } from "@/lib/time";
import { AdminPage, DataTable, FilterBar, pagedTable, useUrlState, type Column } from "../shell";
import { Mono, OrderStatusBadge, OrdersViews } from "./commerce-bits";
import { GATEWAY_LABEL, ORDER_TABS, dayToIso, isoToDay, type OrderTab } from "./commerce-model";

const GATEWAYS: GatewayName[] = ["STRIPE", "RAZORPAY", "FREE"];

export function AdminOrders() {
  const url = useUrlState();
  const router = useRouter();
  const q = url.get("q");
  const status = (ORDER_TABS.some((t) => t.value === url.get("status")) ? url.get("status") : "all") as OrderTab;
  const gateway = (GATEWAYS as string[]).includes(url.get("gateway")) ? (url.get("gateway") as GatewayName) : null;
  const [exportOpen, setExportOpen] = useState(false);

  const list = usePagedList<AdminOrderRow>({
    queryKey: qk.admin.list("orders", { q, status, gateway }),
    fetchPage: (cursor) => api().adminCommerce.orders({ q: q || undefined, status: status === "all" ? undefined : status, gateway: gateway ?? undefined, cursor, limit: 30 }),
  });

  const columns = useMemo<Column<AdminOrderRow>[]>(
    () => [
      {
        key: "number",
        header: "Order",
        cell: (r) => (
          <Link href={`/admin/orders/${r.id}`} className="hover:text-primary hover:underline" data-testid={`order-link-${r.number}`}>
            <Mono>{r.number}</Mono>
          </Link>
        ),
        className: "whitespace-nowrap",
      },
      {
        key: "learner",
        header: "Learner",
        cell: (r) => (
          <div className="min-w-0 max-w-[220px]">
            <p className="truncate font-medium text-foreground">{r.user.displayName}</p>
            <p className="truncate text-[12.5px] text-muted-foreground">{r.user.email}</p>
          </div>
        ),
      },
      { key: "item", header: "Item", cell: (r) => <span className="line-clamp-2 max-w-[260px]">{r.title}</span>, hideBelow: "md" },
      { key: "total", header: "Total", align: "right", cell: (r) => formatMoney(r.total), sortValue: (r) => r.total.amountMinor },
      {
        key: "refunded",
        header: "Refunded",
        align: "right",
        hideBelow: "lg",
        cell: (r) => (r.refunded.amountMinor > 0 ? formatMoney(r.refunded) : <span className="text-subtle-foreground">None</span>),
      },
      { key: "gateway", header: "Gateway", cell: (r) => GATEWAY_LABEL[r.gateway], hideBelow: "lg" },
      { key: "status", header: "Status", cell: (r) => <OrderStatusBadge status={r.status} /> },
      {
        key: "time",
        header: "Time",
        align: "right",
        hideBelow: "sm",
        cell: (r) => {
          const at = r.paidAt ?? r.createdAt;
          return (
            <span title={`${r.paidAt ? "Paid" : "Created"} ${fullTimestamp(at)}`} className="whitespace-nowrap text-muted-foreground">
              {relativeTime(at)}
            </span>
          );
        },
      },
    ],
    [],
  );

  const filtered = !!q || status !== "all" || !!gateway;

  return (
    <AdminPage
      title="Orders"
      description="Every purchase, its payment, refunds and the access it granted."
      actions={
        <Button variant="outline" onClick={() => setExportOpen(true)} data-testid="orders-export">
          <Download /> Export CSV
        </Button>
      }
      testId="admin-orders"
    >
      <OrdersViews value="orders" />
      <FilterBar
        className="mb-4"
        tabs={ORDER_TABS}
        tab={status}
        onTabChange={(v) => url.set({ status: v === "all" ? null : v })}
        tabsLabel="Order status"
        search={q}
        onSearchChange={(v) => url.set({ q: v })}
        searchPlaceholder="Order number or email"
        testId="orders-filter"
      >
        <Select
          aria-label="Gateway"
          value={gateway ?? "all"}
          onValueChange={(v) => url.set({ gateway: v === "all" ? null : v })}
          options={[{ value: "all", label: "All gateways" }, ...GATEWAYS.map((g) => ({ value: g, label: GATEWAY_LABEL[g] }))]}
          className="h-9 w-40"
          data-testid="orders-gateway"
        />
      </FilterBar>
      <DataTable
        caption="Orders"
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/admin/orders/${r.id}`)}
        rowTestId={(r) => `order-row-${r.number}`}
        empty={{ icon: <Receipt />, title: filtered ? "No orders match" : "No orders yet", description: filtered ? "Try another status, gateway or search." : "Orders show up here as soon as someone checks out." }}
        testId="orders-table"
        {...pagedTable(list)}
      />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </AdminPage>
  );
}

/** The CSV export for a date range (the API allows at most 400 days). */
export function exportRangeError(from: string, to: string): string | null {
  const a = dayToIso(from, "start");
  const b = dayToIso(to, "end");
  if (!a || !b) return "Pick both dates.";
  if (a > b) return "Pick a start date on or before the end date.";
  if ((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000 > 400) return "Export at most 400 days at a time.";
  return null;
}

function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const id = useId();
  const today = isoToDay(new Date().toISOString());
  const [from, setFrom] = useState(() => isoToDay(new Date(Date.now() - 29 * 86_400_000).toISOString()));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rangeError = exportRangeError(from, to);

  const run = async () => {
    if (rangeError || busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await api().adminCommerce.exportOrdersCsv({ from: dayToIso(from, "start")!, to: dayToIso(to, "end")! });
      saveBlob(blob, `orders-${from}-to-${to}.csv`);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="sm" data-testid="orders-export-dialog">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <DialogHeader>
            <DialogTitle>Export orders</DialogTitle>
            <DialogDescription>Orders created between these dates, as a CSV file. Up to 400 days at a time.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" htmlFor={`${id}-from`}>
                <Input id={`${id}-from`} type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} data-testid="orders-export-from" />
              </Field>
              <Field label="To" htmlFor={`${id}-to`}>
                <Input id={`${id}-to`} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} data-testid="orders-export-to" />
              </Field>
            </div>
            {rangeError || error ? (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {rangeError ?? error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!!rangeError} loading={busy} data-testid="orders-export-confirm">
              <Download /> Download CSV
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
