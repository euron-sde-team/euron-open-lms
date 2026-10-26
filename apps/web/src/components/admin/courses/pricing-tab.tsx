"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Skeleton, toast } from "@open-lms/ui";
import type { AdminCourse } from "@open-lms/types";
import { api } from "@/lib/api";
import { useAcademyMeta } from "@/lib/meta";
import { exponentOf, formatMoney, savingPercent, toMinor } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { FormSection, ReadOnlyNote, useSetCourse, type CourseRights } from "./course-bits";
import { priceRows, pricePayload, type PriceRow } from "./authoring-model";

export function PricingTab({ course, rights }: { course: AdminCourse; rights: CourseRights }) {
  const meta = useAcademyMeta();
  if (!meta.data) {
    return (
      <div className="max-w-[760px] space-y-3" aria-busy>
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  return <PricingForm course={course} rights={rights} currencies={meta.data.currencies} defaultCurrency={meta.data.defaultCurrency} />;
}

function PricingForm({ course, rights, currencies, defaultCurrency }: { course: AdminCourse; rights: CourseRights; currencies: string[]; defaultCurrency: string }) {
  const qc = useQueryClient();
  const setCourse = useSetCourse(course.id);
  const initial = useMemo(() => priceRows(currencies, course.prices), [currencies, course.prices]);
  const [rows, setRows] = useState<PriceRow[]>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  useEffect(() => {
    if (!dirty) setRows(initial);
    // Only when the server prices change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const save = useMutation({
    mutationFn: (prices: ReturnType<typeof pricePayload> & { ok: true }) => api().authoring.courses.setPrices(course.id, prices.prices),
    onSuccess: (prices) => {
      setCourse((c) => ({ ...c, prices }));
      void qc.invalidateQueries({ queryKey: qk.admin.detail("courses", course.id) });
      void qc.invalidateQueries({ queryKey: qk.admin.list("courses") });
      toast.success({ title: "Prices saved." });
    },
  });
  const disabled = !rights.canManage;
  const submit = () => {
    const r = pricePayload(rows);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    save.mutate(r);
  };
  const patch = (currency: string, p: Partial<PriceRow>) => setRows((list) => list.map((r) => (r.currency === currency ? { ...r, ...p } : r)));

  return (
    <form
      className="max-w-[760px]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-testid="course-pricing"
      noValidate
    >
      {disabled ? <ReadOnlyNote>{rights.manageReason}</ReadOnlyNote> : null}
      {course.accessMode !== "PAID" ? (
        <p role="note" className="mb-5 border-l-2 border-border pl-3 text-[13.5px] text-muted-foreground">
          {course.accessMode === "FREE" ? "This course is free, so these prices are not used until access is set to Paid on the Details tab." : "This course is for subscribers only, so it is not sold on its own."}
        </p>
      ) : null}
      <FormSection title="Prices" description="Set a price for each currency you sell in. A currency left empty is not offered for this course. The compare-at price shows struck through.">
        <div className="divide-y divide-border border-y border-border">
          <div className="hidden grid-cols-[100px_1fr_1fr_120px] gap-4 py-2 text-[12.5px] font-medium text-muted-foreground sm:grid">
            <span>Currency</span>
            <span>Price</span>
            <span>Compare at</span>
            <span className="text-right">Shows as</span>
          </div>
          {rows.map((r) => {
            const step = 1 / 10 ** exponentOf(r.currency);
            const amount = toMinor(r.amount, r.currency);
            const compare = toMinor(r.compareAt, r.currency);
            const price = r.amount && amount ? { amountMinor: amount, currency: r.currency } : null;
            const compareAt = r.compareAt && compare ? { amountMinor: compare, currency: r.currency } : null;
            const saving = savingPercent(price, compareAt);
            return (
              <div key={r.currency} className="grid grid-cols-2 items-start gap-x-4 gap-y-2 py-3 sm:grid-cols-[100px_1fr_1fr_120px]" data-testid={`price-row-${r.currency}`}>
                <p className="col-span-2 pt-2 text-sm font-semibold sm:col-span-1">
                  {r.currency}
                  {r.currency === defaultCurrency ? <span className="ml-1.5 text-xs font-normal text-subtle-foreground">default</span> : null}
                </p>
                <div>
                  <Input
                    inputMode="decimal"
                    type="number"
                    min={0}
                    step={step}
                    aria-label={`Price in ${r.currency}`}
                    placeholder="Not sold"
                    value={r.amount}
                    disabled={disabled}
                    aria-invalid={!!errors[r.currency] || undefined}
                    onChange={(e) => patch(r.currency, { amount: e.target.value })}
                    data-testid={`price-amount-${r.currency}`}
                  />
                </div>
                <div>
                  <Input
                    inputMode="decimal"
                    type="number"
                    min={0}
                    step={step}
                    aria-label={`Compare-at price in ${r.currency}`}
                    placeholder="Optional"
                    value={r.compareAt}
                    disabled={disabled}
                    onChange={(e) => patch(r.currency, { compareAt: e.target.value })}
                    data-testid={`price-compare-${r.currency}`}
                  />
                </div>
                <p className="col-span-2 pt-2 text-right text-[13.5px] tabular-nums sm:col-span-1" aria-live="polite">
                  {price ? (
                    <>
                      {formatMoney(price)}
                      {compareAt && saving ? <span className="ml-1.5 text-subtle-foreground line-through">{formatMoney(compareAt)}</span> : null}
                    </>
                  ) : (
                    <span className="text-subtle-foreground">Not sold</span>
                  )}
                </p>
                {errors[r.currency] ? (
                  <p role="alert" className="col-span-2 text-xs font-medium text-danger sm:col-span-4 sm:col-start-2">
                    {errors[r.currency]}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        {!disabled ? (
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => (setRows(initial), setErrors({}))}>
              Discard
            </Button>
            <Button type="submit" variant={dirty ? "primary" : "outline"} disabled={!dirty} loading={save.isPending} data-testid="prices-save">
              Save prices
            </Button>
          </div>
        ) : null}
      </FormSection>
    </form>
  );
}
