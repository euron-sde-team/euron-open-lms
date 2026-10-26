"use client";

import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError } from "@open-lms/api-client";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Skeleton, Switch, Textarea, toast } from "@open-lms/ui";
import type { AdminOrderDetail as Detail } from "@open-lms/types";
import { api } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { fullTimestamp, relativeTime } from "@/lib/time";
import { ErrorState, NotFoundState } from "@/components/common/states";
import { UserAvatar } from "@/components/common/user-bits";
import { AdminPage, AdminSection, FactList, StatLine, useAdminSession } from "../shell";
import { Mono, OrderStatusBadge, RefundStatusBadge } from "./commerce-bits";
import { GATEWAY_LABEL, SELLABLE_LABEL, canMoveMoney, defaultRefundAmount, validateRefund } from "./commerce-model";

const BACK = { href: "/admin/orders", label: "Orders" };

export function AdminOrderDetail({ id }: { id: string }) {
  const session = useAdminSession();
  const [refundOpen, setRefundOpen] = useState(false);
  const q = useQuery({ queryKey: qk.admin.detail("orders", id), queryFn: () => api().adminCommerce.order(id) });
  const d = q.data;

  if (q.isError && !d) {
    return (
      <AdminPage title="Order" back={BACK}>
        {isApiError(q.error) && q.error.status === 404 ? <NotFoundState compact title="Order not found" description="It may have been removed, or the link is wrong." /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      </AdminPage>
    );
  }
  if (!d) return <DetailSkeleton />;

  const mover = canMoveMoney(session.role);
  const refundable = d.refundable.amountMinor > 0 && (d.status === "PAID" || d.status === "PARTIALLY_REFUNDED");

  return (
    <AdminPage
      back={BACK}
      title={d.number}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <OrderStatusBadge status={d.status} />
          <span>
            {d.title} · {GATEWAY_LABEL[d.gateway]} · placed <time dateTime={d.createdAt} title={fullTimestamp(d.createdAt)}>{relativeTime(d.createdAt)}</time>
            {d.paidAt ? (
              <>
                {" "}· paid <time dateTime={d.paidAt} title={fullTimestamp(d.paidAt)}>{relativeTime(d.paidAt)}</time>
              </>
            ) : null}
          </span>
        </span>
      }
      actions={
        refundable && mover ? (
          <Button variant="outline" onClick={() => setRefundOpen(true)} data-testid="order-refund">
            Refund
          </Button>
        ) : null
      }
      testId="admin-order"
    >
      {refundable && !mover ? (
        <p role="note" className="mb-6 border-l-2 border-border pl-3 text-[13.5px] text-muted-foreground" data-testid="order-readonly">
          You can see this order but not refund it. Refunds are done by finance staff or an administrator.
        </p>
      ) : null}

      <StatLine
        className="mb-10"
        items={[
          { label: "Total", value: formatMoney(d.total) },
          { label: "Refunded", value: formatMoney(d.refunded) },
          { label: "Left to refund", value: formatMoney(d.refundable) },
        ]}
        testId="order-totals"
      />

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-10">
          <AdminSection title="Items" id="order-items">
            <Lines d={d} />
          </AdminSection>

          <AdminSection title="Refunds" id="order-refunds">
            {d.refunds.length ? (
              <ul className="divide-y divide-border" data-testid="order-refund-list">
                {d.refunds.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {formatMoney(r.amount)} <span className="ml-1 align-middle"><RefundStatusBadge status={r.status} /></span>
                      </p>
                      <p className="mt-0.5 text-[13.5px] text-foreground">{r.reason}</p>
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                        {[
                          r.requestedBy ? `by ${r.requestedBy.displayName}` : null,
                          r.revokeAccess ? "access revoked" : "access kept",
                          r.settledAt ? `settled ${relativeTime(r.settledAt)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <time dateTime={r.createdAt} title={fullTimestamp(r.createdAt)} className="shrink-0 text-[12.5px] text-muted-foreground">
                      {relativeTime(r.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-muted-foreground">No refunds on this order.</p>
            )}
          </AdminSection>

          <AdminSection title="Events" description="What the payment provider told us, in order." id="order-events">
            {d.events.length ? (
              <ol className="relative space-y-4 border-l border-border pl-5" data-testid="order-events-list">
                {d.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span aria-hidden className="absolute -left-[25px] top-1.5 size-2 rounded-full bg-border" />
                    <p className="text-[13.5px] text-foreground">
                      <Mono>{e.type}</Mono>
                      {e.outcome ? <span className="text-muted-foreground"> · {e.outcome}</span> : null}
                    </p>
                    <time dateTime={e.receivedAt} className="text-[12.5px] text-muted-foreground">
                      {fullTimestamp(e.receivedAt)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13.5px] text-muted-foreground">No provider events recorded.</p>
            )}
          </AdminSection>
        </div>

        <aside className="min-w-0 space-y-10">
          <AdminSection title="Buyer" id="order-buyer">
            <div className="mb-4 flex items-center gap-3">
              <UserAvatar user={d.user} size="md" />
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{d.user.displayName}</p>
                <p className="truncate text-[13px] text-muted-foreground">{d.user.email}</p>
              </div>
            </div>
            {Object.keys(d.billing).length ? (
              <FactList items={Object.entries(d.billing).map(([k, v]) => ({ label: humanKey(k), value: v }))} className="grid-cols-[minmax(0,110px)_minmax(0,1fr)]" />
            ) : (
              <p className="text-[13.5px] text-muted-foreground">No billing details were collected.</p>
            )}
          </AdminSection>

          <AdminSection title="Payment" id="order-payment">
            <FactList
              className="grid-cols-[minmax(0,110px)_minmax(0,1fr)]"
              items={[
                { label: "Gateway", value: GATEWAY_LABEL[d.gateway] },
                ...(d.gatewayRef ? [{ label: "Order ref", value: <Mono className="break-all">{d.gatewayRef}</Mono> }] : []),
                ...(d.gatewayPaymentRef ? [{ label: "Payment ref", value: <Mono className="break-all">{d.gatewayPaymentRef}</Mono> }] : []),
                ...(d.couponCode ? [{ label: "Coupon", value: <Mono>{d.couponCode}</Mono> }] : []),
                ...(d.failureReason ? [{ label: "Failure", value: <span className="text-danger">{d.failureReason}</span> }] : []),
              ]}
            />
          </AdminSection>

          <AdminSection title="Access granted" id="order-access">
            {d.enrollments.length ? (
              <ul className="divide-y divide-border">
                {d.enrollments.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <span className="min-w-0 truncate text-[13.5px]">{e.courseTitle}</span>
                    {e.status === "REVOKED" ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-muted-foreground">This order has not granted access to any course.</p>
            )}
          </AdminSection>

          <AdminSection title="Invoices" id="order-invoices">
            {d.invoices.length ? (
              <ul className="divide-y divide-border">
                {d.invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <Mono>{i.number}</Mono>
                    <span className="flex items-center gap-3 text-[12.5px] text-muted-foreground">
                      {i.kind === "CREDIT_NOTE" ? "Credit note" : "Invoice"}
                      <InvoiceDownload id={i.id} number={i.number} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] text-muted-foreground">No invoices yet.</p>
            )}
          </AdminSection>
        </aside>
      </div>

      {mover ? <RefundDialog order={d} open={refundOpen} onOpenChange={setRefundOpen} /> : null}
    </AdminPage>
  );
}

function Lines({ d }: { d: Detail }) {
  return (
    <div data-testid="order-lines">
      <ul className="divide-y divide-border border-b border-border">
        {d.lines.map((l) => (
          <li key={`${l.type}:${l.id}`} className="flex items-start justify-between gap-4 py-3 first:pt-0">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{l.title}</p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {[SELLABLE_LABEL[l.type], formatMoney(l.unit), l.discount.amountMinor ? `${formatMoney(l.discount)} off` : null, l.tax.amountMinor ? `${formatMoney(l.tax)} tax` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="shrink-0 tabular-nums">{formatMoney(l.total)}</span>
          </li>
        ))}
      </ul>
      <dl className="ml-auto mt-3 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[13.5px]">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right tabular-nums">{formatMoney(d.subtotal)}</dd>
        {d.discount.amountMinor ? (
          <>
            <dt className="text-muted-foreground">Discount{d.couponCode ? ` (${d.couponCode})` : ""}</dt>
            <dd className="text-right tabular-nums">-{formatMoney(d.discount)}</dd>
          </>
        ) : null}
        {d.tax.amountMinor || d.taxLabel ? (
          <>
            <dt className="text-muted-foreground">{d.taxLabel ?? "Tax"}</dt>
            <dd className="text-right tabular-nums">{formatMoney(d.tax)}</dd>
          </>
        ) : null}
        <dt className="font-semibold text-foreground">Total</dt>
        <dd className="text-right font-semibold tabular-nums">{formatMoney(d.total)}</dd>
      </dl>
    </div>
  );
}

const humanKey = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function DetailSkeleton() {
  return (
    <AdminPage back={BACK} title={<Skeleton className="h-8 w-56" />} testId="admin-order">
      <div className="space-y-8" aria-busy>
        <div className="flex gap-10">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-28" />
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 border-t border-border pt-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </AdminPage>
  );
}

function RefundDialog({ order, open, onOpenChange }: { order: Detail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const id = useId();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [revoke, setRevoke] = useState(true);
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(defaultRefundAmount(order.refundable));
    setReason("");
    setRevoke(true);
    setStep("edit");
    setTouched(false);
    setServerError(null);
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const v = validateRefund({ amount, reason }, order.refundable);
  const errors = !v.ok && touched ? v.errors : {};

  const refund = useMutation({
    mutationFn: (body: { amountMinor: number; reason: string; revokeAccess: boolean }) => api().adminCommerce.refund(order.id, body),
    meta: { silent: true },
    onSuccess: (next) => {
      qc.setQueryData(qk.admin.detail("orders", order.id), next);
      void qc.invalidateQueries({ queryKey: qk.admin.list("orders") });
      toast.success({ title: next.refunds[0]?.status === "PENDING" ? "Refund requested. It settles when the provider confirms." : "Refund issued." });
      onOpenChange(false);
    },
    onError: (e) => {
      setServerError(errorMessage(e));
      setStep("edit");
      if (isApiError(e) && (e.code === "REFUND_EXCEEDS" || e.code === "NOT_REFUNDABLE")) void qc.invalidateQueries({ queryKey: qk.admin.detail("orders", order.id) });
    },
  });

  const amountText = v.ok ? formatMoney({ amountMinor: v.amountMinor, currency: order.refundable.currency }) : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !refund.isPending && onOpenChange(o)}>
      <DialogContent size="sm" data-testid="refund-dialog">
        <form
          className="flex min-h-0 flex-1 flex-col"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!v.ok) return;
            if (step === "edit") return setStep("confirm");
            setServerError(null);
            refund.mutate({ amountMinor: v.amountMinor, reason: v.reason, revokeAccess: revoke });
          }}
        >
          <DialogHeader>
            <DialogTitle>{step === "edit" ? `Refund ${order.number}` : `Refund ${amountText}?`}</DialogTitle>
            <DialogDescription>
              {step === "edit"
                ? `Up to ${formatMoney(order.refundable)} is left to refund. The money goes back through ${GATEWAY_LABEL[order.gateway]} to ${order.user.displayName}.`
                : `${amountText} goes back to ${order.user.displayName} (${order.user.email}) through ${GATEWAY_LABEL[order.gateway]}. This can not be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {step === "edit" ? (
              <>
                <Field label={`Amount in ${order.refundable.currency}`} htmlFor={`${id}-amount`} hint={!errors.amount ? `Leave it at ${formatMoney(order.refundable)} for a full refund.` : undefined} error={errors.amount}>
                  <Input
                    id={`${id}-amount`}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-invalid={!!errors.amount || undefined}
                    className="w-40 tabular-nums"
                    data-testid="refund-amount"
                  />
                </Field>
                <Field label="Reason" htmlFor={`${id}-reason`} hint={!errors.reason ? "Kept with the refund and in the audit log." : undefined} error={errors.reason}>
                  <Textarea id={`${id}-reason`} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!errors.reason || undefined} data-testid="refund-reason" />
                </Field>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <label htmlFor={`${id}-revoke`} className="text-sm font-medium text-foreground">
                      Revoke access
                    </label>
                    <p id={`${id}-revoke-help`} className="mt-0.5 text-[12.5px] text-muted-foreground">
                      {revoke
                        ? `Ends the course access this order granted${order.enrollments.length ? ` (${order.enrollments.filter((e) => e.status === "ACTIVE").length} active)` : ""}. The learner sees the course as refunded.`
                        : "The learner keeps their courses. Use this for a goodwill partial refund."}
                    </p>
                  </div>
                  <Switch id={`${id}-revoke`} checked={revoke} onCheckedChange={setRevoke} aria-describedby={`${id}-revoke-help`} data-testid="refund-revoke" />
                </div>
              </>
            ) : (
              <FactList
                className="grid-cols-[minmax(0,110px)_minmax(0,1fr)]"
                items={[
                  { label: "Amount", value: `${amountText}${v.ok && v.full ? " (full)" : ""}` },
                  { label: "Reason", value: reason.trim() },
                  { label: "Access", value: revoke ? "Revoked" : "Kept" },
                ]}
              />
            )}
            {serverError ? (
              <p role="alert" className="text-[13px] font-medium text-danger" data-testid="refund-error">
                {serverError}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => (step === "confirm" ? setStep("edit") : onOpenChange(false))} disabled={refund.isPending}>
              {step === "confirm" ? "Back" : "Cancel"}
            </Button>
            <Button type="submit" variant={step === "confirm" ? "danger" : "primary"} loading={refund.isPending} data-testid={step === "confirm" ? "refund-confirm" : "refund-review"}>
              {step === "confirm" ? `Refund ${amountText}` : "Review refund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Download one invoice or credit note PDF with the staff token, saved under its number. */
function InvoiceDownload({ id, number }: { id: string; number: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="link"
      size="sm"
      loading={busy}
      data-testid="admin-invoice-download"
      onClick={async () => {
        setBusy(true);
        try {
          saveBlob(await api().adminCommerce.invoicePdf(id), `${number}.pdf`);
        } catch (e) {
          toast.error({ title: errorMessage(e) });
        } finally {
          setBusy(false);
        }
      }}
    >
      PDF
    </Button>
  );
}
