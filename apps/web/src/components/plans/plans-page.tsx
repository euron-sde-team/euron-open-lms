"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { BillingInterval, Plan, SubscriptionSummary } from "@open-lms/types";
import { Button, EmptyState, Skeleton, cn } from "@open-lms/ui";
import { CurrencyMenu } from "@/components/catalog/currency-menu";
import { ErrorState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { Page, PageHeader } from "@/components/shell/layouts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { availableIntervals, planPricing, subscriptionCopy } from "@/lib/billing";
import { checkoutUrl } from "@/lib/checkout";
import { useDisplayCurrency } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";

export function PlansPage() {
  return (
    <Suspense fallback={<PlansSkeleton />}>
      <Plans />
    </Suspense>
  );
}

function Plans() {
  const { currency, ready } = useDisplayCurrency();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = useQuery({
    queryKey: qk.plans(currency ?? ""),
    queryFn: () => api().checkout.plans(currency),
    enabled: ready,
    placeholderData: (prev) => prev,
  });
  const plans = q.data ?? [];
  const intervals = availableIntervals(plans);
  const wanted: BillingInterval = params.get("interval") === "year" ? "YEAR" : "MONTH";
  const interval: BillingInterval = intervals.includes(wanted) ? wanted : (intervals[0] ?? "MONTH");
  const sub = user?.subscription ?? null;

  const setInterval = (i: BillingInterval) => {
    const p = new URLSearchParams(params.toString());
    if (i === "YEAR") p.set("interval", "year");
    else p.delete("interval");
    router.replace(`${pathname}${p.size ? `?${p.toString()}` : ""}`, { scroll: false });
  };

  return (
    <Page>
      <PageHeader title="Plans" lead="One subscription opens every course included in the plan. Cancel any time; your progress and certificates stay yours." actions={<CurrencyMenu />} />
      {sub ? <CurrentPlan sub={sub} /> : null}
      {q.isPending || !ready ? (
        <PlansSkeleton bare />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : plans.length === 0 ? (
        <EmptyState title="No plans on sale right now" description="Courses can still be bought one at a time." action={<Button asChild variant="outline"><Link href="/courses">Browse courses</Link></Button>} />
      ) : (
        <>
          {intervals.length > 1 ? (
            <UnderlineTabs
              label="Billing period"
              className="mb-8 border-b-0"
              value={interval}
              onChange={setInterval}
              tabs={[
                { value: "MONTH", label: "Monthly" },
                { value: "YEAR", label: "Yearly" },
              ]}
            />
          ) : null}
          <div className={cn("grid gap-y-10 border-t border-border pt-8", plans.length > 1 && "md:grid-cols-2 md:divide-x md:divide-border", plans.length > 2 && "lg:grid-cols-3")} data-testid="plans-list">
            {plans.map((p, i) => (
              <PlanColumn key={p.id} plan={p} interval={interval} currency={currency} sub={sub} first={i === 0} single={plans.length === 1} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

function CurrentPlan({ sub }: { sub: SubscriptionSummary }) {
  const copy = subscriptionCopy(sub);
  return (
    <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3 border-y border-border py-4" data-testid="plans-current">
      <p className="text-[14.5px]">
        You are on <span className="font-semibold">{sub.plan.name}</span>
        <span className="text-muted-foreground"> · {copy.status}{copy.dateLine ? ` · ${copy.dateLine}` : ""}</span>
      </p>
      <Link href="/account/subscription" className="text-[14px] font-semibold text-link hover:underline" data-testid="plans-manage">
        Manage
      </Link>
    </div>
  );
}

function PlanColumn({ plan, interval, currency, sub, first, single }: { plan: Plan; interval: BillingInterval; currency?: string; sub: SubscriptionSummary | null; first: boolean; single?: boolean }) {
  const pricing = planPricing(plan, interval);
  const current = sub?.plan.id === plan.id;
  const href = checkoutUrl({ type: "PLAN", id: plan.id, interval }, pricing.price?.price.currency ?? currency);
  return (
    <section className={cn("flex flex-col md:px-8", first && "md:pl-0", single && "max-w-[520px]")} data-testid={`plan-${plan.slug}`} aria-labelledby={`plan-${plan.id}-name`}>
      <h2 id={`plan-${plan.id}-name`} className="font-display text-[24px] font-semibold tracking-[-0.02em]">
        {plan.name}
      </h2>
      {plan.description ? <p className="mt-2 text-[15px] text-muted-foreground">{plan.description}</p> : null}
      <div className="mt-5 min-h-[76px]">
        {pricing.price ? (
          <>
            <p className="flex items-baseline gap-1.5">
              <span className="font-display text-[36px] font-semibold tracking-[-0.02em] tabular-nums">{formatMoney(pricing.price.price, { compact: true })}</span>
              <span className="text-[14px] text-muted-foreground">a {interval === "YEAR" ? "year" : "month"}</span>
            </p>
            {pricing.perMonth ? (
              <p className="mt-1 text-[13.5px] text-muted-foreground" data-testid="plan-yearly-note">
                About {formatMoney(pricing.perMonth)} a month
                {pricing.savingPercent && pricing.saving ? `, ${pricing.savingPercent}% less than paying monthly (you save ${formatMoney(pricing.saving, { compact: true })} a year)` : ""}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[14px] text-muted-foreground">Not sold {interval === "YEAR" ? "yearly" : "monthly"} in {currency}. Try another currency or billing period.</p>
        )}
      </div>
      {plan.trialDays > 0 && !sub ? <p className="mt-2 text-[13.5px] font-medium text-primary">{plan.trialDays}-day free trial. You are not charged until it ends.</p> : null}
      <div className="mt-5">
        {current ? (
          <Button asChild variant="outline" block data-testid="plan-manage">
            <Link href="/account/subscription">Manage your plan</Link>
          </Button>
        ) : sub ? (
          <p className="text-[13.5px] text-muted-foreground">You already have a plan. Cancel it first to switch.</p>
        ) : pricing.price ? (
          <Button asChild variant={first ? "primary" : "outline"} block size="lg" data-testid="plan-cta">
            <Link href={href}>{plan.trialDays > 0 ? "Start free trial" : "Subscribe"}</Link>
          </Button>
        ) : null}
      </div>
      {plan.includedCourseCount > 0 || plan.features.length ? (
        <ul className="mt-6 space-y-2.5 text-[14.5px]">
          {plan.includedCourseCount > 0 ? (
            <li className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {plan.includedCourseCount} {plan.includedCourseCount === 1 ? "course" : "courses"} included
            </li>
          ) : null}
          {plan.features.map((f) => (
            <li key={f} className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PlansSkeleton({ bare }: { bare?: boolean }) {
  const body = (
    <div className="grid gap-10 border-t border-border pt-8 md:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-full max-w-sm" />
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
  if (bare) return body;
  return (
    <Page>
      <PageHeader title="Plans" />
      {body}
    </Page>
  );
}
