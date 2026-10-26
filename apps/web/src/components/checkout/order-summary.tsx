"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckoutQuote, Money } from "@open-lms/types";
import { Button, Input, Skeleton, cn } from "@open-lms/ui";
import { CourseCover } from "@/components/course/course-cover";
import { couponView, normaliseCoupon, recurringNote, taxLineLabel, type CheckoutItem } from "@/lib/checkout";
import { formatMoney } from "@/lib/money";

const TYPE_WORD: Record<CheckoutItem["type"], string> = { COURSE: "Course", BUNDLE: "Bundle", PLAN: "Plan" };

export function OrderSummary({
  quote,
  item,
  couponCode,
  onCoupon,
  updating,
}: {
  quote: CheckoutQuote;
  item: CheckoutItem;
  couponCode: string | null;
  onCoupon: (code: string | null) => void;
  updating?: boolean;
}) {
  const first = quote.lines[0];
  const title = first?.title ?? TYPE_WORD[item.type];
  const kind = item.type === "PLAN" ? `Plan, billed ${item.interval === "YEAR" ? "yearly" : "monthly"}` : TYPE_WORD[item.type];
  const tax = taxLineLabel(quote);
  const note = recurringNote(quote);
  return (
    <div className={cn("transition-opacity", updating && "opacity-70")} data-testid="order-summary" aria-busy={updating || undefined}>
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em]">Order summary</h2>
      <div className="mt-4 flex gap-4 border-t border-border pt-4">
        <CourseCover src={null} title={title} seed={item.id} size="sm" rounded="all" className="w-28 shrink-0" />
        <div className="min-w-0">
          <p className="line-clamp-2 font-display text-[16px] font-semibold leading-snug tracking-[-0.01em]" data-testid="summary-title">
            {title}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">{kind}</p>
        </div>
      </div>

      {quote.lines.length > 1 ? (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {quote.lines.map((l) => (
            <li key={`${l.type}:${l.id}`} className="flex justify-between gap-4 py-2.5 text-[14px]">
              <span className="min-w-0 truncate">{l.title}</span>
              <span className="shrink-0 tabular-nums">{formatMoney(l.unit)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="mt-4 space-y-2 border-t border-border pt-4 text-[14px]">
        <Row label="Subtotal" value={quote.subtotal} testId="summary-subtotal" />
        {quote.discount.amountMinor > 0 ? <Row label={quote.coupon ? `Discount (${quote.coupon.code})` : "Discount"} value={quote.discount} negative testId="summary-discount" /> : null}
        {tax ? <Row label={tax} value={quote.tax} testId="summary-tax" /> : null}
      </dl>
      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-border pt-3">
        <span className="font-semibold">Total{quote.recurring?.trialDays ? " today" : ""}</span>
        <span className="font-display text-[26px] font-semibold tracking-[-0.02em] tabular-nums" data-testid="summary-total" aria-live="polite">
          {formatMoney(quote.total)}
        </span>
      </div>
      {note ? (
        <p className="mt-2 text-[13px] text-muted-foreground" data-testid="summary-recurring">
          {note}
        </p>
      ) : null}

      <CouponRow quote={quote} couponCode={couponCode} onCoupon={onCoupon} updating={!!updating} />
    </div>
  );
}

function Row({ label, value, negative, testId }: { label: string; value: Money; negative?: boolean; testId?: string }) {
  return (
    <div className="flex justify-between gap-4" data-testid={testId}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{negative ? `-${formatMoney(value)}` : formatMoney(value)}</dd>
    </div>
  );
}

/** "Have a coupon?" opens an input; an applied code reads "CODE · 20% off · Remove". */
export function CouponRow({ quote, couponCode, onCoupon, updating }: { quote: CheckoutQuote | null; couponCode: string | null; onCoupon: (code: string | null) => void; updating: boolean }) {
  const view = couponView(quote, couponCode);
  const [open, setOpen] = useState(!!couponCode);
  const [text, setText] = useState(couponCode ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && view.state !== "applied") inputRef.current?.focus();
    // Focus only when the field opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (view.state === "applied") {
    return (
      <p className="mt-5 flex flex-wrap items-center gap-x-1.5 border-t border-border pt-4 text-[14px]" data-testid="coupon-applied">
        <span className="font-semibold">{view.label}</span>
        <span aria-hidden className="text-subtle-foreground">·</span>
        <button
          type="button"
          className="font-medium text-link hover:underline"
          data-testid="coupon-remove"
          onClick={() => {
            onCoupon(null);
            setText("");
            setOpen(false);
          }}
        >
          Remove
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <p className="mt-5 border-t border-border pt-4">
        <button type="button" className="text-[14px] font-medium text-link hover:underline" onClick={() => setOpen(true)} data-testid="coupon-open">
          Have a coupon?
        </button>
      </p>
    );
  }

  const code = normaliseCoupon(text);
  const pending = updating && !!couponCode && couponCode === code;
  return (
    <form
      className="mt-5 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (code) onCoupon(code);
      }}
      noValidate
    >
      <label htmlFor="coupon-code" className="text-[13px] font-medium">
        Coupon code
      </label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id="coupon-code"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          className="uppercase"
          aria-invalid={view.state === "error" || undefined}
          aria-describedby={view.state === "error" ? "coupon-error" : undefined}
          data-testid="coupon-input"
        />
        <Button type="submit" variant="outline" disabled={!code} loading={pending} data-testid="coupon-apply">
          Apply
        </Button>
      </div>
      {view.state === "error" && view.code === code ? (
        <p id="coupon-error" role="alert" className="mt-1.5 text-[13px] font-medium text-danger" data-testid="coupon-error">
          {view.message}
        </p>
      ) : null}
      <button
        type="button"
        className="mt-2 text-[13px] text-muted-foreground hover:text-foreground"
        onClick={() => {
          setOpen(false);
          setText("");
          if (couponCode) onCoupon(null);
        }}
      >
        Cancel
      </button>
    </form>
  );
}

export function SummarySkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-36" />
      <div className="flex gap-4 border-t border-border pt-4">
        <Skeleton className="aspect-video w-28 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}
