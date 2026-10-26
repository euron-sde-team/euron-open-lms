"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ImagePlus, Plus, X } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Button, Field, IconButton, Input, Select, Skeleton, Textarea, toast } from "@open-lms/ui";
import type { AdminBundle, AdminCourseRow, Money } from "@open-lms/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { exponentOf, formatMoney, savingPercent } from "@/lib/money";
import { qk } from "@/lib/query-keys";
import { CourseCover } from "@/components/course/course-cover";
import { DetailSection, DetailSheet, SearchInput } from "../shell";
import { useAllCourses, useCurrencies } from "./commerce-bits";
import {
  CATALOG_STATUS_LABEL, bundleFormSchema, bundlePriceRows, moveItem, parseAmount, separatelyTotal, slugify, validateBundlePrices, type BundleForm, type BundlePriceRow,
} from "./commerce-model";

const STATUS_OPTIONS = (["DRAFT", "ACTIVE", "ARCHIVED"] as const).map((s) => ({ value: s, label: CATALOG_STATUS_LABEL[s] }));

export function BundleSheet({ id, onClose, onCreated }: { id: string | null; onClose: () => void; onCreated: (b: AdminBundle) => void }) {
  const isNew = id === "new";
  const q = useQuery({ queryKey: qk.admin.detail("bundles", id ?? ""), queryFn: () => api().adminCommerce.bundle(id!), enabled: !!id && !isNew });
  const { ready } = useCurrencies();
  const b = isNew ? null : q.data ?? null;
  return (
    <DetailSheet
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? "New bundle" : b?.title ?? ""}
      description={isNew ? "Draft bundles are not on sale. Add courses and prices, then make it active." : b ? `${b.courseIds.length} ${b.courseIds.length === 1 ? "course" : "courses"}` : undefined}
      loading={(!isNew && q.isPending && !!id) || !ready}
      error={isNew ? undefined : q.error}
      onRetry={() => void q.refetch()}
      width="max-w-2xl"
      testId="bundle-sheet"
    >
      {id && (isNew || b) ? <BundleFormBody key={b?.id ?? "new"} bundle={b} onClose={onClose} onCreated={onCreated} /> : null}
    </DetailSheet>
  );
}

function BundleFormBody({ bundle, onClose, onCreated }: { bundle: AdminBundle | null; onClose: () => void; onCreated: (b: AdminBundle) => void }) {
  const id = useId();
  const qc = useQueryClient();
  const { currencies, defaultCurrency } = useCurrencies();
  const courses = useAllCourses();
  const form = useForm<BundleForm>({
    resolver: zodResolver(bundleFormSchema),
    defaultValues: bundle ? { title: bundle.title, slug: bundle.slug, description: bundle.description, status: bundle.status, courseIds: bundle.courseIds } : { title: "", slug: "", description: "", status: "DRAFT", courseIds: [] },
    mode: "onBlur",
  });
  const { register, handleSubmit, formState, setValue, watch, setError } = form;
  const slugTouched = useRef(!!bundle);
  const title = watch("title");
  useEffect(() => {
    if (!slugTouched.current) setValue("slug", slugify(title ?? ""));
  }, [title, setValue]);

  const courseIds = watch("courseIds");
  const byId = useMemo(() => new Map((courses.data ?? []).map((c) => [c.id, c])), [courses.data]);
  const picked = courseIds.map((cid) => byId.get(cid)).filter((c): c is AdminCourseRow => !!c);

  const initialRows = useMemo(() => bundlePriceRows(currencies, bundle?.prices ?? []), [currencies, bundle]);
  const [rows, setRows] = useState<BundlePriceRow[]>(initialRows);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const pricesDirty = JSON.stringify(rows) !== JSON.stringify(initialRows);

  const [cover, setCover] = useState<{ uploadId: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const pickCover = async (file: File) => {
    const preview = URL.createObjectURL(file);
    setUploading(0);
    try {
      const media = await api().media.upload({ purpose: "COURSE_COVER", file, onProgress: (f) => setUploading(f) });
      setCover({ uploadId: media.id, preview });
    } catch (e) {
      URL.revokeObjectURL(preview);
      toast.error({ title: errorMessage(e) });
    } finally {
      setUploading(null);
    }
  };

  const submit = handleSubmit(async (values) => {
    const prices = validateBundlePrices(rows);
    if (!prices.ok) return setPriceErrors(prices.errors);
    setPriceErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const body = {
        title: values.title.trim(),
        slug: values.slug.trim(),
        description: values.description.trim(),
        status: values.status,
        courseIds: values.courseIds,
        ...(cover ? { coverUploadId: cover.uploadId } : {}),
      };
      let saved = bundle ? await api().adminCommerce.updateBundle(bundle.id, body) : await api().adminCommerce.createBundle(body);
      if (!bundle ? prices.prices.length > 0 : pricesDirty) saved = { ...saved, prices: await api().adminCommerce.setBundlePrices(saved.id, prices.prices) };
      qc.setQueryData(qk.admin.detail("bundles", saved.id), saved);
      void qc.invalidateQueries({ queryKey: qk.admin.list("bundles") });
      void qc.invalidateQueries({ queryKey: qk.bundles });
      toast.success({ title: bundle ? "Bundle saved." : "Bundle created." });
      if (!bundle) onCreated(saved);
    } catch (e) {
      if (isApiError(e) && e.code === "SLUG_TAKEN") setError("slug", { message: errorMessage(e) });
      else if (isApiError(e) && (e.code === "BUNDLE_EMPTY" || e.code === "UNKNOWN_COURSE")) setError("courseIds", { message: errorMessage(e) });
      else setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  });

  const e = formState.errors;
  const coverSrc = cover?.preview ?? bundle?.cover?.url ?? null;

  return (
    <form onSubmit={(ev) => void submit(ev)} noValidate className="flex min-h-full flex-col" data-testid="bundle-form">
      <DetailSection title="Details">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full max-w-[240px] overflow-hidden rounded-card">
              <CourseCover src={coverSrc} title={title || "Bundle"} seed={watch("slug") || "bundle"} size="sm" rounded="all" />
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Upload a cover image"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  ev.target.value = "";
                  if (f) void pickCover(f);
                }}
                data-testid="bundle-cover-input"
              />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={uploading !== null} data-testid="bundle-cover-upload">
                <ImagePlus /> {coverSrc ? "Replace cover" : "Upload cover"}
              </Button>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground" aria-live="polite">
                {uploading !== null ? `Uploading ${Math.round(uploading * 100)}%` : cover ? "New cover, saved with the bundle." : "16:9, JPG, PNG or WebP."}
              </p>
            </div>
          </div>
          <Field label="Title" htmlFor={`${id}-title`} error={e.title?.message}>
            <Input id={`${id}-title`} {...register("title")} aria-invalid={!!e.title || undefined} data-testid="bundle-title" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
            <Field label="Slug" htmlFor={`${id}-slug`} error={e.slug?.message}>
              <Input id={`${id}-slug`} {...register("slug", { onChange: () => (slugTouched.current = true) })} aria-invalid={!!e.slug || undefined} className="font-mono text-[13.5px]" data-testid="bundle-slug" />
            </Field>
            <Field label="Status" htmlFor={`${id}-status`}>
              <Select id={`${id}-status`} value={watch("status")} onValueChange={(v) => setValue("status", v as BundleForm["status"], { shouldValidate: formState.isSubmitted })} options={STATUS_OPTIONS} data-testid="bundle-status" />
            </Field>
          </div>
          <Field label="Description" htmlFor={`${id}-desc`} optional error={e.description?.message}>
            <Textarea id={`${id}-desc`} rows={4} {...register("description")} data-testid="bundle-description" />
          </Field>
        </div>
      </DetailSection>

      <DetailSection title={`Courses (${courseIds.length})`} testId="bundle-courses">
        <CoursePicker
          all={courses.data}
          loading={courses.isPending}
          value={courseIds}
          onChange={(next) => setValue("courseIds", next, { shouldDirty: true, shouldValidate: formState.isSubmitted })}
        />
        {e.courseIds?.message ? (
          <p role="alert" className="mt-2 text-xs font-medium text-danger">
            {e.courseIds.message}
          </p>
        ) : null}
      </DetailSection>

      <DetailSection title="Prices" testId="bundle-prices">
        <p className="-mt-1 mb-3 text-[12.5px] text-muted-foreground">A currency left empty is not offered for this bundle. The compare-at price shows struck through.</p>
        <ul className="divide-y divide-border border-y border-border">
          {rows.map((r) => {
            const a = r.amount.trim() ? parseAmount(r.amount, r.currency) : null;
            const price: Money | null = a && "minor" in a && a.minor > 0 ? { amountMinor: a.minor, currency: r.currency } : null;
            const sep = picked.length ? separatelyTotal(picked, r.currency) : null;
            const saving = price && sep && !sep.missing ? savingPercent(price, sep.total) : null;
            const step = 1 / 10 ** exponentOf(r.currency);
            return (
              <li key={r.currency} className="py-3" data-testid={`bundle-price-row-${r.currency}`}>
                <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                  <span className="text-sm font-semibold">
                    {r.currency}
                    {r.currency === defaultCurrency ? <span className="block text-[11px] font-normal text-subtle-foreground">default</span> : null}
                  </span>
                  <Input
                    aria-label={`Price in ${r.currency}`}
                    inputMode="decimal"
                    type="number"
                    min={0}
                    step={step}
                    placeholder="Not sold"
                    value={r.amount}
                    onChange={(ev) => setRows((list) => list.map((x) => (x.currency === r.currency ? { ...x, amount: ev.target.value } : x)))}
                    aria-invalid={!!priceErrors[r.currency] || undefined}
                    data-testid={`bundle-price-amount-${r.currency}`}
                  />
                  <Input
                    aria-label={`Compare-at price in ${r.currency}`}
                    inputMode="decimal"
                    type="number"
                    min={0}
                    step={step}
                    placeholder="Compare at (optional)"
                    value={r.compareAt}
                    onChange={(ev) => setRows((list) => list.map((x) => (x.currency === r.currency ? { ...x, compareAt: ev.target.value } : x)))}
                    data-testid={`bundle-price-compare-${r.currency}`}
                  />
                </div>
                {priceErrors[r.currency] ? (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                    {priceErrors[r.currency]}
                  </p>
                ) : sep ? (
                  <p className="mt-1.5 text-[12.5px] tabular-nums text-muted-foreground" aria-live="polite" data-testid={`bundle-separately-${r.currency}`}>
                    {sep.missing
                      ? `${sep.missing} of ${picked.length} ${picked.length === 1 ? "course has" : "courses have"} no ${r.currency} price, so there is no comparison.`
                      : `Courses separately: ${formatMoney(sep.total)}${price ? (saving ? ` · this bundle saves ${saving}%` : price.amountMinor >= sep.total.amountMinor ? " · this bundle costs the same or more" : "") : ""}`}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
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
        <Button type="submit" loading={busy} disabled={uploading !== null} data-testid="bundle-save">
          {bundle ? "Save bundle" : "Create bundle"}
        </Button>
      </div>
    </form>
  );
}

/** Pick courses (search, add) and order them (up, down, remove). */
function CoursePicker({ all, loading, value, onChange }: { all: AdminCourseRow[] | undefined; loading: boolean; value: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map((all ?? []).map((c) => [c.id, c])), [all]);
  const term = q.trim().toLowerCase();
  const matches = useMemo(
    () => (all ?? []).filter((c) => !value.includes(c.id) && c.status !== "ARCHIVED" && (!term || c.title.toLowerCase().includes(term) || c.slug.includes(term))).slice(0, 8),
    [all, value, term],
  );

  return (
    <div className="space-y-4">
      {value.length ? (
        <ol className="divide-y divide-border border-y border-border" aria-label="Courses in this bundle, in order">
          {value.map((cid, i) => {
            const c = byId.get(cid);
            return (
              <li key={cid} className="flex items-center gap-3 py-2" data-testid={`bundle-course-${c?.slug ?? cid}`}>
                <span className="w-5 text-right text-[12.5px] tabular-nums text-subtle-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  {c ? (
                    <>
                      <p className="truncate text-[14px] font-medium">{c.title}</p>
                      <p className="truncate text-[12.5px] text-muted-foreground">{c.prices.length ? c.prices.map((m) => formatMoney(m, { compact: true })).join(" · ") : c.accessMode === "FREE" ? "Free" : "No price"}</p>
                    </>
                  ) : loading ? (
                    <Skeleton className="h-4 w-40" />
                  ) : (
                    <p className="text-[13.5px] text-muted-foreground">A course you can not see</p>
                  )}
                </div>
                <IconButton type="button" size="sm" label="Move up" disabled={i === 0} onClick={() => onChange(moveItem(value, i, i - 1))}>
                  <ArrowUp />
                </IconButton>
                <IconButton type="button" size="sm" label="Move down" disabled={i === value.length - 1} onClick={() => onChange(moveItem(value, i, i + 1))}>
                  <ArrowDown />
                </IconButton>
                <IconButton type="button" size="sm" label={`Remove ${c?.title ?? "course"}`} onClick={() => onChange(value.filter((x) => x !== cid))}>
                  <X />
                </IconButton>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-[13.5px] text-muted-foreground">No courses yet. Add at least one before making the bundle active.</p>
      )}
      <div>
        <SearchInput value={q} onChange={setQ} placeholder="Find a course to add" debounceMs={120} className="sm:w-full" testId="bundle-course-search" />
        {loading ? (
          <div className="mt-2 space-y-2" aria-busy>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : matches.length ? (
          <ul className="mt-2 divide-y divide-border">
            {matches.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-[13.5px]">{c.title}</span>
                <Button size="sm" variant="ghost" onClick={() => onChange([...value, c.id])} data-testid={`bundle-course-add-${c.slug}`}>
                  <Plus /> Add
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">{term ? "No other course matches." : "Every course is already in the bundle."}</p>
        )}
      </div>
    </div>
  );
}
