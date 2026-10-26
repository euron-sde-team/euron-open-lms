"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import type { Invoice, Money, Order } from "@open-lms/types";
import { Badge, Button, Skeleton } from "@open-lms/ui";
import { useInvoiceDownload } from "@/components/checkout/use-invoice-download";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { ORDER_STATUS, dateOnly, failureCopy, isPaidStatus, itemHref } from "@/lib/billing";
import { orderHref } from "@/lib/checkout";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";

/** Credit notes issued against an order (the invoices list carries the order number). */
export const creditNotesFor = (invoices: Invoice[], order: Pick<Order, "number">) => invoices.filter((i) => i.kind === "CREDIT_NOTE" && i.orderNumber === order.number);

export function OrderDetailSection({ orderId }: { orderId: string }) {
  const q = useQuery({ queryKey: qk.order(orderId), queryFn: () => api().checkout.order(orderId) });
  const invoices = useQuery({ queryKey: [...qk.invoices, "first"], queryFn: () => api().billing.invoices({ limit: 50 }), enabled: !!q.data && q.data.refunded.amountMinor > 0 });
  const download = useInvoiceDownload();

  if (q.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;
  const status = ORDER_STATUS[o.status];
  const notes = invoices.data ? creditNotesFor(invoices.data.items, o) : [];

  return (
    <div data-testid="order-detail">
      <Link href="/account/orders" className="inline-flex items-center gap-1 text-[13.5px] font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All orders
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Order {o.number}</h1>
        <Badge tone={status.tone} size="md">
          {status.label}
        </Badge>
      </div>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        {[`Placed ${dateOnly(o.createdAt)}`, o.paidAt ? `paid ${dateOnly(o.paidAt)}` : null, o.kind === "SUBSCRIPTION" ? "subscription" : null, o.gateway !== "FREE" ? `via ${o.gateway === "STRIPE" ? "Stripe" : "Razorpay"}` : null].filter(Boolean).join(" · ")}
      </p>
      {o.status === "FAILED" || o.status === "EXPIRED" ? <p className="mt-3 text-[14px] text-muted-foreground">{failureCopy(o.failureReason)}</p> : null}
      {o.status === "PENDING" ? (
        <p className="mt-3 text-[14px]">
          This order is waiting for payment.{" "}
          <Link href={orderHref(o.id)} className="font-semibold text-link hover:underline">
            Check its status
          </Link>
        </p>
      ) : null}

      <ul className="mt-6 divide-y divide-border border-y border-border">
        {o.lines.map((l) => (
          <li key={`${l.type}:${l.id}`} className="flex items-baseline justify-between gap-4 py-3">
            <div className="min-w-0">
              <Link href={itemHref(l)} className="font-medium hover:text-primary">
                {l.title}
              </Link>
              <p className="text-[12.5px] text-muted-foreground">{l.type === "COURSE" ? "Course" : l.type === "BUNDLE" ? "Bundle" : "Plan"}</p>
            </div>
            <span className="shrink-0 tabular-nums">{formatMoney(l.unit)}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-4 max-w-[380px] space-y-2 text-[14px] sm:ml-auto">
        <Line label="Subtotal" value={o.subtotal} />
        {o.discount.amountMinor > 0 ? <Line label={o.couponCode ? `Discount (${o.couponCode})` : "Discount"} value={o.discount} negative /> : null}
        {o.tax.amountMinor > 0 ? <Line label={o.taxLabel ?? "Tax"} value={o.tax} /> : null}
        <div className="flex justify-between gap-4 border-t border-border pt-2 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(o.total)}</dd>
        </div>
        {o.refunded.amountMinor > 0 ? <Line label="Refunded" value={o.refunded} negative /> : null}
      </dl>

      {isPaidStatus(o.status) ? (
        <div className="mt-8 border-t border-border pt-6">
          <h2 className="font-display text-[18px] font-semibold">Documents</h2>
          <ul className="mt-3 space-y-2 text-[14px]">
            {o.invoice ? (
              <li className="flex flex-wrap items-center gap-3">
                <span>Invoice {o.invoice.number}</span>
                {o.invoice.ready ? (
                  <Button variant="ghost" size="sm" onClick={() => download.mutate({ id: o.invoice!.id, number: o.invoice!.number })} loading={download.isPending && download.variables?.id === o.invoice.id} data-testid="order-detail-invoice">
                    <Download /> Download PDF
                  </Button>
                ) : (
                  <span className="text-muted-foreground">Being prepared</span>
                )}
              </li>
            ) : (
              <li className="text-muted-foreground">No invoice for this order.</li>
            )}
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-3">
                <span>
                  Credit note {n.number} · {formatMoney(n.total)} · {dateOnly(n.issuedAt)}
                </span>
                {n.ready ? (
                  <Button variant="ghost" size="sm" onClick={() => download.mutate({ id: n.id, number: n.number })} data-testid="order-detail-credit-note">
                    <Download /> Download PDF
                  </Button>
                ) : (
                  <span className="text-muted-foreground">Being prepared</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Line({ label, value, negative }: { label: string; value: Money; negative?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{negative ? `-${formatMoney(value)}` : formatMoney(value)}</dd>
    </div>
  );
}
