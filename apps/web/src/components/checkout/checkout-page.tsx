"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import type { CheckoutQuote, CheckoutQuoteRequest } from "@open-lms/types";
import { Button, Field, Input, NativeSelect, Select, Skeleton, cn } from "@open-lms/ui";
import { NotFoundState } from "@/components/common/states";
import { Page, PageHeader } from "@/components/shell/layouts";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import {
  billingFor,
  checkoutProblem,
  checkoutUrl,
  clearIdempotencyKey,
  countryOptions,
  ensureIdempotencyKey,
  gatewayLine,
  guessCountry,
  idempotencyKeyFor,
  loadScriptOnce,
  parseCheckoutSearch,
  payLabel,
  requestFingerprint,
  runHandoff,
  type CheckoutItem,
  type CheckoutProblem,
} from "@/lib/checkout";
import { useDisplayCurrency } from "@/lib/currency";
import { errorMessage } from "@/lib/errors";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useAcademyMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { OrderSummary, SummarySkeleton } from "./order-summary";

export function CheckoutPage() {
  return (
    <Suspense fallback={<CheckoutSkeleton />}>
      <CheckoutFromUrl />
    </Suspense>
  );
}

function CheckoutFromUrl() {
  const params = useSearchParams();
  const parsed = useMemo(() => parseCheckoutSearch(params), [params]);
  const meta = useAcademyMeta();
  const display = useDisplayCurrency();
  if (!parsed) return <Page><NotFoundState title="This checkout link is incomplete" description="Open the course, bundle or plan again and choose Buy." /></Page>;
  if (!parsed.currency && !display.ready) return <CheckoutSkeleton />;
  const currency = parsed.currency ?? display.currency ?? meta.data?.defaultCurrency ?? "USD";
  return <Checkout key={`${parsed.item.type}:${parsed.item.id}:${parsed.item.interval ?? ""}`} item={parsed.item} currency={currency} />;
}

type PayState = { kind: "idle" } | { kind: "starting" } | { kind: "modal" } | { kind: "confirming" } | { kind: "dismissed" } | { kind: "failed"; message: string };

export function Checkout({ item, currency }: { item: CheckoutItem; currency: string }) {
  const me = useMe();
  const router = useRouter();
  const meta = useAcademyMeta();
  const currencies = meta.data?.currencies ?? [];

  const [name, setName] = useState(me.certificateName || me.displayName);
  const [country, setCountry] = useState("");
  const [taxId, setTaxId] = useState("");
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [pay, setPay] = useState<PayState>({ kind: "idle" });
  const [startProblem, setStartProblem] = useState<CheckoutProblem | null>(null);

  // One key per page view, reused after a reload (see lib/checkout.ts).
  useEffect(() => {
    ensureIdempotencyKey(item);
    setCountry((c) => c || guessCountry(currency));
  }, [item, currency]);

  const billing = billingFor({ name, country, taxId });
  const billingKey = JSON.stringify(billing ?? null);
  const settledBillingKey = useDebounced(billingKey, 400);
  const settledBilling = useMemo(() => JSON.parse(settledBillingKey) as CheckoutQuoteRequest["billing"] | null, [settledBillingKey]);

  const request: CheckoutQuoteRequest = useMemo(
    () => ({ item: { type: item.type, id: item.id, ...(item.interval ? { interval: item.interval } : {}) }, currency, ...(couponCode ? { couponCode } : {}), ...(settledBilling ? { billing: settledBilling } : {}) }),
    [item, currency, couponCode, settledBilling],
  );
  const quote = useQuery({
    queryKey: qk.quote(request as unknown as Record<string, unknown>),
    queryFn: () => api().checkout.quote(request),
    placeholderData: keepPreviousData,
    retry: false,
    meta: { silent: true },
  });
  const q: CheckoutQuote | undefined = quote.data;
  const backHref = item.type === "PLAN" ? "/plans" : null;
  const quoteProblem = quote.isError ? checkoutProblem(quote.error, { currency, backHref }) : q?.alreadyOwned ? checkoutProblem("ALREADY_OWNED") : null;
  const problem = startProblem ?? quoteProblem;
  const settling = billingKey !== settledBillingKey || quote.isFetching;
  const busy = pay.kind === "starting" || pay.kind === "confirming";

  const setCurrencyInUrl = (c: string) => {
    setStartProblem(null);
    router.replace(checkoutUrl(item, c), { scroll: false });
  };

  const onPay = async () => {
    if (!q || !billing) return;
    setStartProblem(null);
    setPay({ kind: "starting" });
    // The coupon goes along only if the quote accepted it (a refused code would 409 the start).
    const body: CheckoutQuoteRequest = { ...request, billing, ...(q.coupon && couponCode ? { couponCode } : { couponCode: undefined }) };
    if (!body.couponCode) delete body.couponCode;
    const fp = requestFingerprint(body);
    const start = (key: string) => api().checkout.start({ ...body, idempotencyKey: key });
    try {
      let handoff;
      try {
        handoff = await start(idempotencyKeyFor(item, fp));
      } catch (e) {
        // The order this key made has closed (canceled, expired): start a new one, once.
        if (isApiError(e) && (e.code === "CHECKOUT_CLOSED" || e.code === "CHECKOUT_EXPIRED")) {
          clearIdempotencyKey(item);
          handoff = await start(idempotencyKeyFor(item, fp));
        } else throw e;
      }
      if (handoff.type === "FULFILLED") clearIdempotencyKey(item);
      if (handoff.type === "RAZORPAY_MODAL") setPay({ kind: "modal" });
      await runHandoff(handoff, {
        assign: (url) => window.location.assign(url),
        navigate: (path) => router.push(path),
        loadScript: (url) => loadScriptOnce(url),
        getRazorpay: () => window.Razorpay,
        confirm: (b) => api().checkout.razorpayConfirm(b),
        onConfirming: () => setPay({ kind: "confirming" }),
        onDismiss: () => setPay((s) => (s.kind === "confirming" ? s : { kind: "dismissed" })),
        onFailed: (reason) => setPay({ kind: "failed", message: reason ? `${reason} You were not charged.` : "The payment did not go through. You were not charged." }),
        onConfirmError: (_e, orderId) => router.push(`/checkout/orders/${encodeURIComponent(orderId)}`),
      });
    } catch (e) {
      const p = checkoutProblem(e, { currency, backHref });
      if (p) {
        setStartProblem(p);
        setPay({ kind: "idle" });
      } else setPay({ kind: "failed", message: errorMessage(e) });
    }
  };

  const countries = useMemo(() => countryOptions(), []);

  return (
    <Page>
      <PageHeader title="Checkout" className="pb-4" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14">
        {/* Summary first on phones, on the right from lg. */}
        <aside className="order-1 lg:order-2" aria-label="Order summary">
          <div className="lg:sticky lg:top-24">
            {q ? (
              <OrderSummary quote={q} item={item} couponCode={couponCode} onCoupon={setCouponCode} updating={quote.isFetching} />
            ) : quote.isError ? (
              <p className="border-t border-border pt-5 text-[14.5px] text-muted-foreground">The summary appears once this item can be priced.</p>
            ) : (
              <SummarySkeleton />
            )}
          </div>
        </aside>

        <div className="order-2 min-w-0 space-y-10 lg:order-1">
          {problem ? <ProblemNotice problem={problem} currencies={currencies} currency={currency} onCurrency={setCurrencyInUrl} /> : null}

          <section aria-labelledby="billing-heading">
            <h2 id="billing-heading" className="font-display text-[20px] font-semibold tracking-[-0.01em]">
              Billing details
            </h2>
            <p className="mt-1 text-[14px] text-muted-foreground">Printed on your receipt. Your country decides the tax.</p>
            <div className="mt-5 grid max-w-[520px] gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="billing-name" className="sm:col-span-2">
                <Input id="billing-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="billing-name" maxLength={120} />
              </Field>
              <Field label="Country" htmlFor="billing-country">
                <NativeSelect id="billing-country" autoComplete="country" value={country} onChange={(e) => setCountry(e.target.value)} data-testid="billing-country">
                  <option value="">Choose a country</option>
                  {countries.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Tax ID" optional htmlFor="billing-tax-id" hint="GSTIN, VAT or similar, for a business receipt">
                <Input id="billing-tax-id" value={taxId} onChange={(e) => setTaxId(e.target.value)} data-testid="billing-tax-id" maxLength={40} autoComplete="off" spellCheck={false} />
              </Field>
            </div>
          </section>

          {currencies.length > 1 ? (
            <section aria-labelledby="currency-heading">
              <h2 id="currency-heading" className="font-display text-[20px] font-semibold tracking-[-0.01em]">
                Currency
              </h2>
              <div className="mt-3 max-w-[240px]">
                <Select value={currency} onValueChange={setCurrencyInUrl} options={currencies.map((c) => ({ value: c, label: c }))} aria-label="Pay in" data-testid="checkout-currency" />
              </div>
            </section>
          ) : null}

          <section aria-labelledby="payment-heading" className="border-t border-border pt-8">
            <h2 id="payment-heading" className="sr-only">
              Payment
            </h2>
            <p className="flex items-center gap-2 text-[14px] text-muted-foreground" data-testid="checkout-gateway">
              <Lock className="size-4" aria-hidden />
              {q ? gatewayLine(q.gateway) : "Secure payment"}
            </p>
            <div aria-live="polite" className="mt-3 min-h-0 empty:hidden">
              {pay.kind === "dismissed" ? (
                <p className="text-[14px] text-muted-foreground" data-testid="checkout-dismissed">
                  Payment not completed. You were not charged.{" "}
                  <button type="button" className="font-semibold text-link hover:underline" onClick={() => void onPay()}>
                    Try again
                  </button>
                </p>
              ) : pay.kind === "failed" ? (
                <p className="text-[14px] text-danger" role="alert" data-testid="checkout-failed">
                  {pay.message}
                </p>
              ) : pay.kind === "confirming" ? (
                <p className="text-[14px] text-muted-foreground">Confirming your payment...</p>
              ) : null}
            </div>
            <Button
              size="lg"
              className="mt-4 w-full sm:w-auto sm:min-w-[260px]"
              loading={busy || pay.kind === "modal"}
              disabled={!q || !billing || settling || !!quoteProblem || q.alreadyOwned}
              onClick={() => void onPay()}
              data-testid="checkout-pay"
            >
              {q ? payLabel(q) : "Pay"}
            </Button>
            {!billing ? <p className="mt-2 text-[13px] text-muted-foreground">Add your name and country to continue.</p> : null}
            <p className="mt-4 max-w-[520px] text-[12.5px] text-subtle-foreground">
              Prices are set on our side and cannot change on the payment page. {item.type === "PLAN" ? "You can cancel the plan any time from your account." : "Your receipt arrives by email and stays in your orders."}
            </p>
          </section>
        </div>
      </div>
    </Page>
  );
}

function ProblemNotice({ problem, currencies, currency, onCurrency }: { problem: CheckoutProblem; currencies: string[]; currency: string; onCurrency: (c: string) => void }) {
  const others = problem.currencyFix ? currencies.filter((c) => c !== currency) : [];
  return (
    <div role="alert" className="border-l-2 border-ink pl-4" data-testid={`checkout-problem-${problem.code}`}>
      <p className="font-semibold">{problem.title}</p>
      <p className="mt-1 text-[14.5px] text-muted-foreground">{problem.body}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
        {problem.link ? (
          <Link href={problem.link.href} className="font-semibold text-link hover:underline">
            {problem.link.label}
          </Link>
        ) : null}
        {others.map((c) => (
          <button key={c} type="button" className="font-semibold text-link hover:underline" onClick={() => onCurrency(c)}>
            Pay in {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <Page>
      <PageHeader title="Checkout" className="pb-4" />
      <div className={cn("grid gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14")}>
        <div className="order-2 space-y-4 lg:order-1">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-10 w-full max-w-[520px]" />
          <Skeleton className="h-10 w-full max-w-[520px]" />
          <Skeleton className="mt-8 h-12 w-64" />
        </div>
        <div className="order-1 lg:order-2">
          <SummarySkeleton />
        </div>
      </div>
    </Page>
  );
}
