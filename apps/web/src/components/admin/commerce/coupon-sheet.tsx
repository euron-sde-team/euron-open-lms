"use client";

import { useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Shuffle, X } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Button, Field, IconButton, Input, Select, Skeleton, Switch, Textarea, toast } from "@open-lms/ui";
import type { AdminCoupon, SellableType } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { exponentOf } from "@/lib/money";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { DetailSection, DetailSheet, SearchInput } from "../shell";
import { Mono, useAllBundles, useAllCourses, useCurrencies, usePlansList } from "./commerce-bits";
import {
  COUPON_SCOPE_LABEL, SELLABLE_LABEL, couponFormSchema, couponPatchPayload, couponPayload, couponServerField, couponToForm, couponValueLabel, emptyCouponForm, generateCouponCode, redemptionsLabel, type CouponForm, type CouponTarget,
} from "./commerce-model";

const KIND_OPTIONS = [
  { value: "PERCENT", label: "Percentage off" },
  { value: "FIXED", label: "Fixed amount off" },
];
const SCOPE_OPTIONS = (["ALL", "COURSES", "BUNDLES", "PLANS", "SPECIFIC"] as const).map((s) => ({ value: s, label: COUPON_SCOPE_LABEL[s] }));

export function CouponSheet({ open, coupon, loading, onClose, onSaved }: { open: boolean; coupon: AdminCoupon | null; loading?: boolean; onClose: () => void; onSaved: (c: AdminCoupon, created: boolean) => void }) {
  const { ready } = useCurrencies();
  return (
    <DetailSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={coupon ? <Mono className="text-[19px] font-semibold">{coupon.code}</Mono> : loading ? "" : "New coupon"}
      description={coupon ? `${couponValueLabel(coupon)} · ${redemptionsLabel(coupon)}` : loading ? undefined : "Learners type the code at checkout."}
      loading={loading || !ready}
      width="max-w-xl"
      testId="coupon-sheet"
    >
      {open && !loading && ready ? <CouponFormBody key={coupon?.id ?? "new"} coupon={coupon} onClose={onClose} onSaved={onSaved} /> : null}
    </DetailSheet>
  );
}

function CouponFormBody({ coupon, onClose, onSaved }: { coupon: AdminCoupon | null; onClose: () => void; onSaved: (c: AdminCoupon, created: boolean) => void }) {
  const id = useId();
  const editing = !!coupon;
  const { currencies, defaultCurrency } = useCurrencies();
  const form = useForm<CouponForm>({ resolver: zodResolver(couponFormSchema), defaultValues: coupon ? couponToForm(coupon, defaultCurrency) : emptyCouponForm(defaultCurrency), mode: "onBlur" });
  const { register, handleSubmit, formState, setValue, watch, setError } = form;
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const kind = watch("kind");
  const scope = watch("scope");
  const currency = watch("currency");
  const targets = watch("targets");
  const active = watch("active");
  const e = formState.errors;
  const opts = { shouldDirty: true, shouldValidate: formState.isSubmitted };

  const submit = handleSubmit(async (values) => {
    setBusy(true);
    setFormError(null);
    try {
      const saved = editing ? await api().adminCommerce.updateCoupon(coupon.id, couponPatchPayload(values)) : await api().adminCommerce.createCoupon(couponPayload(values));
      toast.success({ title: editing ? `${saved.code} saved.` : `${saved.code} created.` });
      onSaved(saved, !editing);
    } catch (err) {
      if (isApiError(err) && err.code === "COUPON_CODE_TAKEN") setError("code", { message: errorMessage(err) });
      else if (isApiError(err) && err.code === "BELOW_REDEMPTIONS") setError("maxRedemptions", { message: errorMessage(err) });
      else if (isApiError(err) && err.code === "UNKNOWN_TARGET") setError("targets", { message: errorMessage(err) });
      else if (isApiError(err) && err.code === "VALIDATION_FAILED") {
        const fields = Object.entries(err.fieldErrors);
        let mapped = false;
        for (const [path, msg] of fields) {
          const f = couponServerField(path);
          if (f) {
            setError(f, { message: msg.charAt(0).toUpperCase() + msg.slice(1) });
            mapped = true;
          }
        }
        if (!mapped) setFormError(err.message || errorMessage(err));
      } else setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  });

  return (
    <form onSubmit={(ev) => void submit(ev)} noValidate className="flex min-h-full flex-col" data-testid="coupon-form">
      <DetailSection title="Code and discount">
        <div className="space-y-4">
          {editing ? <p className="text-[12.5px] text-muted-foreground">The code, discount and what it applies to are fixed once a coupon exists. Turn this one off and create a new one to change them.</p> : null}
          <Field label="Code" htmlFor={`${id}-code`} hint={!e.code && !editing ? "3 to 40 letters, digits, dashes or underscores." : undefined} error={e.code?.message}>
            <div className="flex gap-2">
              <Input id={`${id}-code`} {...register("code")} disabled={editing} autoComplete="off" spellCheck={false} aria-invalid={!!e.code || undefined} className="font-mono tracking-wide" data-testid="coupon-code" />
              {!editing ? (
                <Button variant="outline" onClick={() => setValue("code", generateCouponCode(), { ...opts, shouldValidate: true })} data-testid="coupon-generate">
                  <Shuffle /> Generate
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Description" htmlFor={`${id}-desc`} optional hint={!e.description ? "For your team only, like “Launch week”." : undefined} error={e.description?.message}>
            <Textarea id={`${id}-desc`} rows={2} maxLength={200} {...register("description")} data-testid="coupon-description" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discount" htmlFor={`${id}-kind`}>
              <Select id={`${id}-kind`} value={kind} onValueChange={(v) => setValue("kind", v as CouponForm["kind"], opts)} options={KIND_OPTIONS} disabled={editing} data-testid="coupon-kind" />
            </Field>
            {kind === "PERCENT" ? (
              <Field label="Percent off" htmlFor={`${id}-pct`} error={e.percentOff?.message}>
                <div className="relative">
                  <Input id={`${id}-pct`} inputMode="numeric" {...register("percentOff")} disabled={editing} aria-invalid={!!e.percentOff || undefined} className="pr-8" data-testid="coupon-percent" />
                  <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                </div>
              </Field>
            ) : (
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
                <Field label="Currency" htmlFor={`${id}-cur`} error={e.currency?.message}>
                  <Select id={`${id}-cur`} value={currency || undefined} onValueChange={(v) => setValue("currency", v, opts)} options={[...new Set([...currencies, ...(currency ? [currency] : [])])].map((c) => ({ value: c, label: c }))} disabled={editing} data-testid="coupon-currency" />
                </Field>
                <Field label="Amount off" htmlFor={`${id}-amt`} error={e.amountOff?.message}>
                  <Input id={`${id}-amt`} inputMode="decimal" type="number" min={0} step={currency ? 1 / 10 ** exponentOf(currency) : undefined} {...register("amountOff")} disabled={editing} aria-invalid={!!e.amountOff || undefined} data-testid="coupon-amount" />
                </Field>
              </div>
            )}
          </div>
          {kind === "FIXED" ? <p className="-mt-2 text-[12.5px] text-muted-foreground">A fixed amount only applies to checkouts in that currency.</p> : null}
        </div>
      </DetailSection>

      <DetailSection title="Applies to">
        <Field label="Scope" htmlFor={`${id}-scope`}>
          <Select id={`${id}-scope`} value={scope} onValueChange={(v) => setValue("scope", v as CouponForm["scope"], opts)} options={SCOPE_OPTIONS} disabled={editing} data-testid="coupon-scope" />
        </Field>
        {scope === "SPECIFIC" ? (
          <div className="mt-4">
            <TargetPicker value={targets} onChange={(t) => setValue("targets", t, opts)} />
            {e.targets?.message ? (
              <p role="alert" className="mt-2 text-xs font-medium text-danger">
                {e.targets.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </DetailSection>

      <DetailSection title="Limits">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Total uses" htmlFor={`${id}-max`} optional hint={!e.maxRedemptions ? (coupon ? `Used ${coupon.redemptionCount} times so far. Empty for no limit.` : "Empty for no limit.") : undefined} error={e.maxRedemptions?.message}>
              <Input id={`${id}-max`} inputMode="numeric" {...register("maxRedemptions")} aria-invalid={!!e.maxRedemptions || undefined} data-testid="coupon-max" />
            </Field>
            <Field label="Uses per learner" htmlFor={`${id}-per`} error={e.perUserLimit?.message}>
              <Input id={`${id}-per`} inputMode="numeric" {...register("perUserLimit")} aria-invalid={!!e.perUserLimit || undefined} data-testid="coupon-per-user" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" htmlFor={`${id}-start`} optional hint={!e.startsAt ? "Empty to start now." : undefined} error={e.startsAt?.message}>
              <Input id={`${id}-start`} type="date" {...register("startsAt")} data-testid="coupon-starts" />
            </Field>
            <Field label="Expires" htmlFor={`${id}-end`} optional hint={!e.expiresAt ? "Works through the end of this day." : undefined} error={e.expiresAt?.message}>
              <Input id={`${id}-end`} type="date" {...register("expiresAt")} aria-invalid={!!e.expiresAt || undefined} data-testid="coupon-expires" />
            </Field>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <label htmlFor={`${id}-active`} className="text-sm font-medium text-foreground">
                Active
              </label>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">{active ? "Learners can use it inside the dates above." : "Nobody can use it until you turn it on."}</p>
            </div>
            <Switch id={`${id}-active`} checked={active} onCheckedChange={(v) => setValue("active", v, opts)} data-testid="coupon-active" />
          </div>
        </div>
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
        <Button type="submit" loading={busy} data-testid="coupon-save">
          {editing ? "Save coupon" : "Create coupon"}
        </Button>
      </div>
    </form>
  );
}

type PickTab = "COURSE" | "BUNDLE" | "PLAN";
const PICK_TABS: { value: PickTab; label: string }[] = [
  { value: "COURSE", label: "Courses" },
  { value: "BUNDLE", label: "Bundles" },
  { value: "PLAN", label: "Plans" },
];

/** Pick specific courses, bundles and plans for a SPECIFIC coupon. */
function TargetPicker({ value, onChange }: { value: CouponTarget[]; onChange: (t: CouponTarget[]) => void }) {
  const [tab, setTab] = useState<PickTab>("COURSE");
  const [q, setQ] = useState("");
  const courses = useAllCourses(tab === "COURSE");
  const bundles = useAllBundles(tab === "BUNDLE");
  const plans = usePlansList(tab === "PLAN");
  const source = tab === "COURSE" ? courses : tab === "BUNDLE" ? bundles : plans;
  const options = useMemo<CouponTarget[]>(() => {
    if (tab === "COURSE") return (courses.data ?? []).map((c) => ({ type: "COURSE" as SellableType, id: c.id, title: c.title }));
    if (tab === "BUNDLE") return (bundles.data ?? []).map((b) => ({ type: "BUNDLE" as SellableType, id: b.id, title: b.title }));
    return (plans.data ?? []).map((p) => ({ type: "PLAN" as SellableType, id: p.id, title: p.name }));
  }, [tab, courses.data, bundles.data, plans.data]);
  const term = q.trim().toLowerCase();
  const chosen = new Set(value.map((t) => `${t.type}:${t.id}`));
  const matches = options.filter((o) => !chosen.has(`${o.type}:${o.id}`) && (!term || o.title.toLowerCase().includes(term))).slice(0, 8);

  return (
    <div className="space-y-4" data-testid="coupon-targets">
      {value.length ? (
        <ul className="divide-y divide-border border-y border-border" aria-label="Picked items">
          {value.map((t) => (
            <li key={`${t.type}:${t.id}`} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{t.title}</p>
                <p className="text-[12.5px] text-muted-foreground">{SELLABLE_LABEL[t.type]}</p>
              </div>
              <IconButton type="button" size="sm" label={`Remove ${t.title}`} onClick={() => onChange(value.filter((x) => !(x.type === t.type && x.id === t.id)))}>
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13.5px] text-muted-foreground">Nothing picked yet.</p>
      )}
      <div>
        <UnderlineTabs tabs={PICK_TABS} value={tab} onChange={setTab} label="Item type" size="sm" className="mb-3" />
        <SearchInput value={q} onChange={setQ} placeholder={`Find ${tab === "COURSE" ? "a course" : tab === "BUNDLE" ? "a bundle" : "a plan"}`} debounceMs={120} className="sm:w-full" testId="coupon-target-search" />
        {source.isPending ? (
          <div className="mt-2 space-y-2" aria-busy>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : matches.length ? (
          <ul className="mt-2 divide-y divide-border">
            {matches.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-[13.5px]">{o.title}</span>
                <Button size="sm" variant="ghost" onClick={() => onChange([...value, o])} data-testid={`coupon-target-add-${o.id}`}>
                  <Plus /> Add
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">{term ? "Nothing else matches." : options.length ? "Everything here is already picked." : "None yet."}</p>
        )}
      </div>
    </div>
  );
}
