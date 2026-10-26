"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SubscriptionSummary } from "@open-lms/types";
import { Badge, Button, EmptyState, Skeleton, toast } from "@open-lms/ui";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cancelExplainer, subscriptionCopy } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { AccountSection, SectionTitle } from "./section";

export function SubscriptionSection() {
  const qc = useQueryClient();
  const { reloadMe } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const q = useQuery({ queryKey: qk.subscription, queryFn: () => api().billing.subscription() });
  const applied = (s: SubscriptionSummary) => {
    qc.setQueryData(qk.subscription, s);
    void reloadMe().catch(() => undefined);
    void qc.invalidateQueries({ queryKey: qk.catalogAll });
    void qc.invalidateQueries({ queryKey: qk.courseAll });
  };
  const cancel = useMutation({
    mutationFn: () => api().billing.cancelSubscription(),
    onSuccess: (s) => {
      applied(s);
      toast.success({ title: "Your plan will not renew", description: "You keep access until the end of the period." });
    },
  });
  const resume = useMutation({
    mutationFn: () => api().billing.resumeSubscription(),
    onSuccess: (s) => {
      applied(s);
      toast.success({ title: "Your plan will renew as usual" });
    },
  });

  return (
    <div>
      <SectionTitle title="Subscription" lead="Your plan, when it renews and what it costs." />
      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-10 w-40" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <EmptyState
          title="You do not have a plan"
          description="A plan opens every course it includes for as long as it runs."
          action={
            <Button asChild>
              <Link href="/plans">See plans</Link>
            </Button>
          }
        />
      ) : (
        <SubscriptionView sub={q.data} onCancel={() => setConfirming(true)} onResume={() => resume.mutate()} resuming={resume.isPending} />
      )}
      {q.data ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Cancel ${q.data.plan.name}?`}
          description={cancelExplainer(q.data)}
          confirmLabel="Cancel plan"
          cancelLabel="Keep my plan"
          destructive
          onConfirm={() => cancel.mutateAsync()}
          testId="subscription-cancel-dialog"
        />
      ) : null}
    </div>
  );
}

export function SubscriptionView({ sub, onCancel, onResume, resuming }: { sub: SubscriptionSummary; onCancel: () => void; onResume: () => void; resuming?: boolean }) {
  const copy = subscriptionCopy(sub);
  return (
    <>
      <AccountSection
        title={
          <span className="flex flex-wrap items-center gap-3">
            {sub.plan.name}
            <Badge tone={copy.tone} size="md" data-testid="subscription-status">
              {copy.status}
            </Badge>
          </span>
        }
        description={
          <span data-testid="subscription-date">
            {/* The renewal line already names the price when there is one. */}
            {[copy.dateLine?.includes(formatMoney(sub.price)) ? null : `${formatMoney(sub.price)} a ${sub.interval === "YEAR" ? "year" : "month"}`, copy.dateLine].filter(Boolean).join(" · ")}
          </span>
        }
        testId="subscription"
        actions={
          <>
            {copy.canResume ? (
              <Button onClick={onResume} loading={resuming} data-testid="subscription-resume">
                Keep my plan
              </Button>
            ) : null}
            {copy.canCancel ? (
              <Button variant="outline" onClick={onCancel} data-testid="subscription-cancel">
                Cancel plan
              </Button>
            ) : null}
            {!copy.canCancel && !copy.canResume && !copy.live ? (
              <Button asChild>
                <Link href="/plans">See plans</Link>
              </Button>
            ) : null}
          </>
        }
      >
        {copy.warning ? (
          <div role="alert" className="max-w-[620px] border-l-2 border-danger pl-4 text-[14.5px]" data-testid="subscription-warning">
            {copy.warning}
          </div>
        ) : (
          <p className="text-[14px] text-muted-foreground">{copy.live ? "Courses in this plan are open to you now." : "Courses in this plan are locked. Your progress is kept if you subscribe again."}</p>
        )}
      </AccountSection>
      <p className="text-[13px] text-muted-foreground">
        Billed through {sub.gateway === "STRIPE" ? "Stripe" : sub.gateway === "RAZORPAY" ? "Razorpay" : "the academy"}. Receipts for every payment are in{" "}
        <Link href="/account/orders" className="font-medium text-link hover:underline">
          Orders
        </Link>
        .
      </p>
    </>
  );
}
