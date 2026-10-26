"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download } from "lucide-react";
import type { Order } from "@open-lms/types";
import { Button, Skeleton, Spinner } from "@open-lms/ui";
import { ErrorState } from "@/components/common/states";
import { Page } from "@/components/shell/layouts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateOnly, failureCopy, itemHref, orderPhase, orderTitle, pollInterval, type OrderPhase } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { useInvoiceDownload } from "./use-invoice-download";

export function OrderStatusPage({ orderId }: { orderId: string }) {
  return (
    <Suspense fallback={<OrderSkeleton />}>
      <OrderStatus orderId={orderId} />
    </Suspense>
  );
}

/**
 * The polling query behind the return page: the first call asks the API to sync with the
 * gateway once (`?sync=1`), later calls are plain reads every 2 s while the order is
 * PENDING, for up to a minute.
 */
export function useOrderPolling(orderId: string, opts: { cancel?: boolean } = {}) {
  const startedAt = useRef(Date.now());
  const calls = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const q = useQuery({
    queryKey: qk.order(orderId),
    queryFn: async () => {
      const first = calls.current === 0;
      calls.current += 1;
      if (first && opts.cancel) {
        // Back from the gateway's cancel link: close the unpaid order so a new checkout can start.
        const o = await api().checkout.order(orderId, { sync: true });
        if (o.status !== "PENDING") return o;
        return api().checkout.cancelOrder(orderId).catch(() => api().checkout.order(orderId));
      }
      return api().checkout.order(orderId, { sync: first });
    },
    refetchInterval: (query) => pollInterval(query.state.data, Date.now() - startedAt.current),
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: 2,
  });
  // Tick so the timeout state appears even though the last poll returned PENDING.
  const phase = orderPhase(q.data, now - startedAt.current);
  useEffect(() => {
    if (phase !== "pending") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);
  return { ...q, phase };
}

function OrderStatus({ orderId }: { orderId: string }) {
  const canceled = useSearchParams().get("canceled") === "1";
  const q = useOrderPolling(orderId, { cancel: canceled });
  const qc = useQueryClient();
  const { reloadMe } = useAuth();
  const refreshed = useRef(false);

  useEffect(() => {
    if (q.phase !== "paid" || refreshed.current) return;
    refreshed.current = true;
    void reloadMe().catch(() => undefined);
    for (const key of [qk.me, qk.classroomAll, qk.catalogAll, qk.courseAll, qk.myLearningAll, qk.mySummary, qk.orders, qk.invoices, qk.subscription, ["bundle"], ["featured"]]) void qc.invalidateQueries({ queryKey: key });
  }, [q.phase, qc, reloadMe]);

  if (q.isError && !q.data) return <Page width="reading"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Page>;
  if (!q.data) return <OrderSkeleton />;
  return (
    <Page width="reading">
      <OrderOutcome order={q.data} phase={q.phase} />
    </Page>
  );
}

export function OrderOutcome({ order, phase }: { order: Order; phase: OrderPhase }) {
  const title = orderTitle(order);
  const back = itemHref(order.lines[0]);
  if (phase === "paid") return <Paid order={order} />;
  if (phase === "failed") {
    return (
      <Outcome testId="order-failed" title="The payment did not go through" lead={failureCopy(order.failureReason)}>
        <Button asChild size="lg">
          <Link href={back}>Try again</Link>
        </Button>
      </Outcome>
    );
  }
  if (phase === "canceled") {
    return (
      <Outcome testId="order-canceled" title="Checkout canceled" lead={`You were not charged for ${title}. You can come back to it any time.`}>
        <Button asChild size="lg" variant="outline">
          <Link href={back}>Back to {order.lines[0]?.type === "PLAN" ? "plans" : order.lines[0]?.type === "BUNDLE" ? "the bundle" : "the course"}</Link>
        </Button>
      </Outcome>
    );
  }
  if (phase === "timeout") {
    return (
      <Outcome
        testId="order-processing"
        title="Your payment is still processing"
        lead="Some payments take a few minutes to confirm. You can leave this page: we will email you as soon as it clears, and your course opens on its own."
      >
        <Button asChild variant="outline">
          <Link href="/account/orders">See your orders</Link>
        </Button>
      </Outcome>
    );
  }
  return (
    <div className="py-16 text-center" data-testid="order-pending" aria-live="polite">
      <Spinner size="lg" />
      <p className="mt-4 font-display text-[22px] font-semibold tracking-[-0.01em]">Confirming your payment</p>
      <p className="mt-1 text-[14.5px] text-muted-foreground">This usually takes a few seconds. Keep this page open.</p>
    </div>
  );
}

function Outcome({ title, lead, children, testId }: { title: string; lead: string; children?: React.ReactNode; testId: string }) {
  return (
    <div className="py-10" data-testid={testId} aria-live="polite">
      <h1 className="font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">{title}</h1>
      <p className="mt-3 text-[15.5px] text-muted-foreground">{lead}</p>
      <div className="mt-6 flex flex-wrap gap-3">{children}</div>
    </div>
  );
}

function Paid({ order }: { order: Order }) {
  const invoice = order.invoice;
  const download = useInvoiceDownload();
  const plan = order.lines[0]?.type === "PLAN";
  const trial = plan && order.total.amountMinor === 0;
  return (
    <div className="py-10" data-testid="order-paid" aria-live="polite">
      <CheckCircle2 className="size-8 text-success" aria-hidden />
      <h1 className="mt-4 font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.02em]">{plan ? (trial ? "Your free trial has started" : "Your plan is active") : "You are enrolled"}</h1>
      <p className="mt-3 text-[15.5px] text-muted-foreground">
        {trial ? "You are not charged until the trial ends. Cancel any time from your account." : order.total.amountMinor > 0 ? `Payment of ${formatMoney(order.total)} received.` : "No payment was needed."} A receipt is on its way to your inbox.
      </p>
      <ul className="mt-6 divide-y divide-border border-y border-border">
        {order.lines.map((l) => (
          <li key={`${l.type}:${l.id}`} className="flex items-baseline justify-between gap-4 py-3 text-[14.5px]">
            <span className="min-w-0 font-medium">{l.title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(l.total)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-muted-foreground">
        Receipt {order.number}
        {order.paidAt ? ` · ${dateOnly(order.paidAt)}` : ""}
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button asChild size="lg" data-testid="order-continue">
          <Link href={order.continueTo ?? "/my-learning"}>Start learning</Link>
        </Button>
        {invoice?.ready ? (
          <Button variant="ghost" onClick={() => download.mutate({ id: invoice.id, number: invoice.number })} loading={download.isPending} data-testid="order-invoice">
            <Download /> Invoice {invoice.number}
          </Button>
        ) : invoice ? (
          <p className="text-[13px] text-muted-foreground">Your invoice is being prepared. It will be in your orders shortly.</p>
        ) : null}
      </div>
    </div>
  );
}

function OrderSkeleton() {
  return (
    <Page width="reading">
      <div className="space-y-4 py-10">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-12 w-full" />
      </div>
    </Page>
  );
}
