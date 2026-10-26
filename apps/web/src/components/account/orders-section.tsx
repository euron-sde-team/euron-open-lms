"use client";

import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import type { Order } from "@open-lms/types";
import { Badge, Button, EmptyState, Skeleton } from "@open-lms/ui";
import { useInvoiceDownload } from "@/components/checkout/use-invoice-download";
import { ErrorState, LoadMore } from "@/components/common/states";
import { api } from "@/lib/api";
import { ORDER_STATUS, dateOnly, orderTitle } from "@/lib/billing";
import { usePagedList } from "@/lib/hooks/queries";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { SectionTitle } from "./section";

export const accountOrderHref = (id: string) => `/account/orders/${encodeURIComponent(id)}`;

export function OrdersSection() {
  const list = usePagedList<Order>({ queryKey: qk.orders, fetchPage: (cursor) => api().billing.orders({ cursor }) });
  const download = useInvoiceDownload();
  return (
    <div>
      <SectionTitle title="Orders" lead="Everything you have bought, with receipts and invoices." />
      {list.isPending ? (
        <div className="divide-y divide-border border-y border-border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 py-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="No orders yet"
          description="Courses, bundles and plans you buy show up here with their receipts."
          action={
            <Button asChild variant="outline">
              <Link href="/courses">Browse courses</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-border border-y border-border" data-testid="orders-list">
            {list.items.map((o) => {
              const status = ORDER_STATUS[o.status];
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 sm:flex-nowrap" data-testid="order-row">
                  <Link href={accountOrderHref(o.id)} className="min-w-0 flex-1 group">
                    <p className="truncate text-[15px] font-semibold group-hover:text-primary">{orderTitle(o)}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      {o.number} · {dateOnly(o.paidAt ?? o.createdAt)}
                    </p>
                  </Link>
                  <span className="w-32 text-right">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </span>
                  <span className="w-24 text-right font-semibold tabular-nums">{formatMoney(o.total)}</span>
                  <span className="w-28 text-right">
                    {o.invoice?.ready ? (
                      <Button variant="ghost" size="sm" onClick={() => download.mutate({ id: o.invoice!.id, number: o.invoice!.number })} data-testid="order-invoice-download" aria-label={`Download invoice ${o.invoice.number}`}>
                        <Download /> Invoice
                      </Button>
                    ) : o.invoice ? (
                      <span className="text-[12.5px] text-subtle-foreground">Invoice soon</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <LoadMore sentinelRef={list.sentinelRef} loading={list.isFetchingNextPage} hasMore={!!list.hasNextPage} onClick={() => void list.fetchNextPage()} />
        </>
      )}
    </div>
  );
}
