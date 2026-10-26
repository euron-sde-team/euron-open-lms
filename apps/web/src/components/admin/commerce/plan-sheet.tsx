"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Button, Field, IconButton, Input, Select, Textarea, toast } from "@open-lms/ui";
import type { AdminPlan, BillingInterval } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { exponentOf, formatMoney } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { DetailSection, DetailSheet } from "../shell";
import { useCurrencies } from "./commerce-bits";
import {
  CATALOG_STATUS_LABEL, INTERVAL_LABEL, INTERVAL_SHORT, emptyPlanForm, nextPlanPriceRow, parseAmount, planFormSchema, planPayload, planPriceRows, planToForm, slugify, validatePlanPrices, type PlanForm, type PlanPriceRow,
} from "./commerce-model";

const STATUS_OPTIONS = (["DRAFT", "ACTIVE", "ARCHIVED"] as const).map((s) => ({ value: s, label: CATALOG_STATUS_LABEL[s] }));
const INTERVAL_OPTIONS = (["MONTH", "YEAR"] as const).map((i) => ({ value: i, label: INTERVAL_LABEL[i] }));

export function PlanSheet({ open, plan, onClose, onCreated }: { open: boolean; plan: AdminPlan | null; onClose: () => void; onCreated: (p: AdminPlan) => void }) {
  return (
    <DetailSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={plan ? plan.name : "New plan"}
      description={plan ? `${new Intl.NumberFormat().format(plan.activeSubscribers)} active ${plan.activeSubscribers === 1 ? "subscriber" : "subscribers"}` : "Draft plans are not on sale. Make it active when the prices are set."}
      width="max-w-2xl"
      testId="plan-sheet"
    >
      {open ? <PlanFormBody key={plan?.id ?? "new"} plan={plan} onClose={onClose} onCreated={onCreated} /> : null}
    </DetailSheet>
  );
}

function PlanFormBody({ plan, onClose, onCreated }: { plan: AdminPlan | null; onClose: () => void; onCreated: (p: AdminPlan) => void }) {
  const id = useId();
  const qc = useQueryClient();
  const { currencies, defaultCurrency } = useCurrencies();
  const form = useForm<PlanForm>({ resolver: zodResolver(planFormSchema), defaultValues: plan ? planToForm(plan) : emptyPlanForm(), mode: "onBlur" });
  const { register, handleSubmit, formState, setValue, watch, setError } = form;
  const features = useFieldArray({ control: form.control, name: "features" });
  const slugTouched = useRef(!!plan);

  const initialRows = useMemo(() => (plan ? planPriceRows(plan.prices) : []), [plan]);
  const [rows, setRows] = useState<PlanPriceRow[]>(initialRows);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const pricesDirty = JSON.stringify(rows.map(({ key: _k, ...r }) => r)) !== JSON.stringify(initialRows.map(({ key: _k, ...r }) => r));

  const name = watch("name");
  useEffect(() => {
    if (!slugTouched.current) setValue("slug", slugify(name ?? ""), { shouldValidate: false });
  }, [name, setValue]);

  // A brand-new plan starts with one monthly price in the default currency.
  useEffect(() => {
    if (!plan && !rows.length && currencies.length) setRows([{ ...nextPlanPriceRow([], [defaultCurrency, ...currencies.filter((c) => c !== defaultCurrency)]) }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencies.length]);

  const patchRow = (key: string, p: Partial<PlanPriceRow>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const submit = handleSubmit(async (values) => {
    const prices = validatePlanPrices(rows, currencies.length ? currencies : undefined);
    if (!prices.ok) {
      setPriceErrors(prices.errors);
      return;
    }
    setPriceErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const body = planPayload(values);
      let saved = plan ? await api().adminCommerce.updatePlan(plan.id, body) : await api().adminCommerce.createPlan(body);
      if (!plan || pricesDirty) {
        const next = await api().adminCommerce.setPlanPrices(saved.id, prices.prices);
        saved = { ...saved, prices: next };
      }
      qc.setQueryData<AdminPlan[]>(qk.admin.list("plans"), (old) => (old ? (old.some((p) => p.id === saved.id) ? old.map((p) => (p.id === saved.id ? saved : p)) : [...old, saved]) : old));
      void qc.invalidateQueries({ queryKey: qk.admin.list("plans") });
      void qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success({ title: plan ? "Plan saved." : "Plan created." });
      if (!plan) onCreated(saved);
    } catch (e) {
      if (isApiError(e) && e.code === "SLUG_TAKEN") setError("slug", { message: errorMessage(e) });
      else if (isApiError(e) && e.code === "VALIDATION_FAILED" && Object.keys(e.fieldErrors).length) {
        for (const [path, msg] of Object.entries(e.fieldErrors)) {
          const head = path.split(".")[0] as keyof PlanForm;
          if (head in values) setError(head, { message: msg });
          else setFormError(msg);
        }
      } else setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  const e = formState.errors;
  const currencyOptions = (current: string) => [...new Set([...currencies, current])].map((c) => ({ value: c, label: c }));

  return (
    <form onSubmit={(ev) => void submit(ev)} noValidate className="flex min-h-full flex-col" data-testid="plan-form">
      <DetailSection title="Details">
        <div className="space-y-4">
          <Field label="Name" htmlFor={`${id}-name`} error={e.name?.message}>
            <Input id={`${id}-name`} {...register("name")} aria-invalid={!!e.name || undefined} data-testid="plan-name" />
          </Field>
          <Field label="Slug" htmlFor={`${id}-slug`} hint={!e.slug ? "Used in links. Lower-case letters, digits and dashes." : undefined} error={e.slug?.message}>
            <Input
              id={`${id}-slug`}
              {...register("slug", { onChange: () => (slugTouched.current = true) })}
              aria-invalid={!!e.slug || undefined}
              className="font-mono text-[13.5px]"
              data-testid="plan-slug"
            />
          </Field>
          <Field label="Description" htmlFor={`${id}-desc`} optional error={e.description?.message}>
            <Textarea id={`${id}-desc`} rows={3} {...register("description")} data-testid="plan-description" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Status" htmlFor={`${id}-status`}>
              <Select id={`${id}-status`} value={watch("status")} onValueChange={(v) => setValue("status", v as PlanForm["status"], { shouldDirty: true })} options={STATUS_OPTIONS} data-testid="plan-status" />
            </Field>
            <Field label="Trial days" htmlFor={`${id}-trial`} error={e.trialDays?.message}>
              <Input id={`${id}-trial`} inputMode="numeric" {...register("trialDays")} aria-invalid={!!e.trialDays || undefined} data-testid="plan-trial" />
            </Field>
            <Field label="Position" htmlFor={`${id}-position`} hint={!e.position ? "Lower comes first." : undefined} error={e.position?.message}>
              <Input id={`${id}-position`} inputMode="numeric" {...register("position")} aria-invalid={!!e.position || undefined} data-testid="plan-position" />
            </Field>
          </div>
        </div>
      </DetailSection>

      <DetailSection
        title="What is included"
        action={
          features.fields.length < 20 ? (
            <Button size="sm" variant="ghost" onClick={() => features.append({ text: "" })} data-testid="plan-feature-add">
              <Plus /> Add a line
            </Button>
          ) : null
        }
      >
        <p className="-mt-1 mb-3 text-[12.5px] text-muted-foreground">Short lines shown on the plans page, like &ldquo;Every course, new ones included&rdquo;. Empty lines are dropped.</p>
        <ul className="space-y-2">
          {features.fields.map((f, i) => (
            <li key={f.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Input aria-label={`Feature ${i + 1}`} {...register(`features.${i}.text` as const)} maxLength={120} data-testid={`plan-feature-${i}`} />
                {e.features?.[i]?.text?.message ? <p className="mt-1 text-xs font-medium text-danger">{e.features[i]!.text!.message}</p> : null}
              </div>
              <IconButton type="button" label={`Remove feature ${i + 1}`} size="md" onClick={() => features.remove(i)}>
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      </DetailSection>

      <DetailSection
        title="Prices"
        testId="plan-prices"
        action={
          rows.length < 20 && currencies.length ? (
            <Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, nextPlanPriceRow(r, currencies)])} data-testid="plan-price-add">
              <Plus /> Add a price
            </Button>
          ) : null
        }
      >
        <p className="-mt-1 mb-3 text-[12.5px] text-muted-foreground">One recurring price per currency and interval. Changing a price applies to new subscribers; existing ones keep theirs.</p>
        {rows.length ? (
          <ul className="divide-y divide-border border-y border-border">
            {rows.map((r) => {
              const parsed = r.amount.trim() ? parseAmount(r.amount, r.currency) : null;
              const preview = parsed && "minor" in parsed && parsed.minor > 0 ? `${formatMoney({ amountMinor: parsed.minor, currency: r.currency })} / ${INTERVAL_SHORT[r.interval]}` : null;
              return (
                <li key={r.key} className="py-3" data-testid={`plan-price-row-${r.currency}-${r.interval}`}>
                  <div className="grid grid-cols-[96px_120px_minmax(0,1fr)_auto] items-center gap-2">
                    <Select aria-label="Currency" value={r.currency} onValueChange={(v) => patchRow(r.key, { currency: v })} options={currencyOptions(r.currency)} data-testid="plan-price-currency" />
                    <Select aria-label="Billing interval" value={r.interval} onValueChange={(v) => patchRow(r.key, { interval: v as BillingInterval })} options={INTERVAL_OPTIONS} data-testid="plan-price-interval" />
                    <Input
                      aria-label={`Amount in ${r.currency} per ${INTERVAL_SHORT[r.interval]}`}
                      inputMode="decimal"
                      type="number"
                      min={0}
                      step={1 / 10 ** exponentOf(r.currency)}
                      placeholder="Amount"
                      value={r.amount}
                      onChange={(ev) => patchRow(r.key, { amount: ev.target.value })}
                      aria-invalid={!!priceErrors[r.key] || undefined}
                      data-testid="plan-price-amount"
                    />
                    <IconButton type="button" label="Remove this price" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}>
                      <X />
                    </IconButton>
                  </div>
                  {priceErrors[r.key] ? (
                    <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                      {priceErrors[r.key]}
                    </p>
                  ) : preview ? (
                    <p className="mt-1.5 text-[12.5px] tabular-nums text-muted-foreground" aria-live="polite">
                      Shows as {preview}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">No prices yet. A plan without prices can not be bought.</p>
        )}
        {priceErrors._form ? <p className="mt-2 text-xs font-medium text-danger">{priceErrors._form}</p> : null}
      </DetailSection>

      <div className="sticky bottom-0 mt-auto flex items-center justify-end gap-2 border-t border-border bg-card py-3">
        {formError ? (
          <p role="alert" className="mr-auto text-[13px] font-medium text-danger">
            {formError}
          </p>
        ) : null}
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" loading={busy} data-testid="plan-save">
          {plan ? "Save plan" : "Create plan"}
        </Button>
      </div>
    </form>
  );
}
