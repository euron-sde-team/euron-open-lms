"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Plus, Trash2 } from "lucide-react";
import { isApiError, validateUpload } from "@open-lms/api-client";
import { Button, Checkbox, Field, IconButton, Input, Select, Skeleton, Switch, Textarea, cn, toast } from "@open-lms/ui";
import type { IntegrationStatus, LmsSettings } from "@open-lms/types";
import { api } from "@/lib/api";
import {
  academySection, analyticsSection, certificatesSection, changeCount, CURRENCY_CHOICES, currencySection, isDirty, learningSection, mapFieldErrors, sellerSection, taxSection, timeZones, toggleCurrency,
  type Errors, type Gateway, type SectionDef,
} from "@/lib/admin-settings";
import { errorMessage } from "@/lib/errors";
import { useAcademyMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { AdminPage, AreaGate } from "../shell";

const settingsKey = qk.admin.detail("settings", "document");

export function AdminSettings() {
  return (
    <AreaGate area="settings">
      <SettingsInner />
    </AreaGate>
  );
}

function SettingsInner() {
  const q = useQuery({ queryKey: settingsKey, queryFn: () => api().admin.settings() });
  return (
    <AdminPage title="Settings" description="How the academy looks, sells and teaches. Each section saves on its own." testId="admin-settings">
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <div className="max-w-[720px] space-y-6" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 border-t border-border pt-6">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ))}
        </div>
      ) : (
        <div className="max-w-[720px]">
          <nav aria-label="Settings sections" className="mb-8 flex flex-wrap gap-x-5 gap-y-1 text-[13.5px]">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="text-muted-foreground hover:text-foreground hover:underline">
                {label}
              </a>
            ))}
          </nav>
          <AcademySection base={q.data} />
          <CurrencySection base={q.data} />
          <TaxSection base={q.data} />
          <SellerSection base={q.data} />
          <LearningSection base={q.data} />
          <CertificatesSection base={q.data} />
          <AnalyticsSection base={q.data} />
          <Integrations />
        </div>
      )}
    </AdminPage>
  );
}

const SECTIONS = [
  ["academy", "Academy"],
  ["currencies", "Currencies and payments"],
  ["tax", "Tax"],
  ["seller", "Seller details"],
  ["learning", "Learning"],
  ["certificates", "Certificates"],
  ["analytics", "Analytics"],
  ["integrations", "Integrations"],
] as const;

// ─── Section plumbing ───────────────────────────────────────────────────────

function useSection<F>(def: SectionDef<F>, base: LmsSettings, groups: string[]) {
  const qc = useQueryClient();
  const [form, setForm] = useState<F>(() => def.toForm(base));
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const local = def.validate(form);
  const errors: Errors = { ...(tried ? local : {}), ...serverErrors };
  const dirty = isDirty(def, base, form);
  const count = dirty ? changeCount(def, base, form) : 0;
  const save = useMutation({
    mutationFn: () => api().admin.updateSettings(def.toPatch(form)),
    meta: { silent: true },
    onSuccess: (next) => {
      qc.setQueryData(settingsKey, next);
      void qc.invalidateQueries({ queryKey: qk.meta });
      setForm(def.toForm(next));
      setTried(false);
      setServerErrors({});
      toast.success({ title: "Settings saved" });
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "VALIDATION_FAILED") setServerErrors(mapFieldErrors(e.fieldErrors, groups));
      toast.error({ title: errorMessage(e) });
    },
  });
  return {
    form,
    set: (patch: Partial<F>) => {
      setServerErrors({});
      setForm((f) => ({ ...f, ...patch }));
    },
    setForm,
    errors,
    dirty,
    count,
    saving: save.isPending,
    submit: () => {
      setTried(true);
      if (Object.keys(local).length) return;
      save.mutate();
    },
    discard: () => {
      setForm(def.toForm(base));
      setTried(false);
      setServerErrors({});
    },
  };
}

function SettingsSection({
  id, title, description, s, children,
}: {
  id: string;
  title: string;
  description: string;
  s: { dirty: boolean; count: number; saving: boolean; submit: () => void; discard: () => void };
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-border py-8 first-of-type:border-t-0 first-of-type:pt-0" data-testid={`settings-${id}`}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          s.submit();
        }}
      >
        <h2 id={`${id}-title`} className="font-display text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">{description}</p>
        <div className="mt-5 space-y-5">{children}</div>
        <div className="mt-6 flex items-center gap-3">
          <Button type="submit" disabled={!s.dirty} loading={s.saving} data-testid={`settings-${id}-save`}>
            Save {title.toLowerCase()}
          </Button>
          {s.dirty ? (
            <>
              <Button type="button" variant="ghost" onClick={s.discard} disabled={s.saving}>
                Discard
              </Button>
              <span className="text-[13px] text-muted-foreground" aria-live="polite">
                {s.count} unsaved {s.count === 1 ? "change" : "changes"}
              </span>
            </>
          ) : null}
        </div>
      </form>
    </section>
  );
}

const err = (e: Errors, k: string) => e[k];
const inv = (e: Errors, k: string) => (e[k] ? true : undefined);

// ─── Academy ────────────────────────────────────────────────────────────────

function AcademySection({ base }: { base: LmsSettings }) {
  const s = useSection(academySection, base, []);
  const meta = useAcademyMeta();
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoUrl = s.form.logoUploadId === null ? null : preview ?? (s.form.logoUploadId === base.logoUploadId ? meta.data?.logoUrl ?? null : null);
  useEffect(() => {
    if (!s.dirty) setPreview(null);
  }, [s.dirty]);

  const upload = async (file: File) => {
    const problem = validateUpload(file);
    if (problem) return toast.error({ title: problem });
    if (!file.type.startsWith("image/")) return toast.error({ title: "The logo must be an image (PNG, JPG, SVG or WebP)." });
    setUploading(true);
    try {
      const media = await api().media.upload({ purpose: "BRANDING", file });
      setPreview(media.url);
      s.set({ logoUploadId: media.id });
    } catch (e) {
      toast.error({ title: errorMessage(e) });
    } finally {
      setUploading(false);
    }
  };

  return (
    <SettingsSection id="academy" title="Academy" description="The name and look learners see across the site, in emails and on certificates." s={s}>
      <Field label="Academy name" htmlFor="set-name" error={err(s.errors, "academyName")}>
        <Input id="set-name" value={s.form.academyName} onChange={(e) => s.set({ academyName: e.target.value })} maxLength={80} aria-invalid={inv(s.errors, "academyName")} data-testid="settings-academy-name" />
      </Field>
      <Field label="Tagline" htmlFor="set-tagline" optional error={err(s.errors, "tagline")} hint="One line under the name on the home page.">
        <Input id="set-tagline" value={s.form.tagline} onChange={(e) => s.set({ tagline: e.target.value })} maxLength={160} aria-invalid={inv(s.errors, "tagline")} data-testid="settings-tagline" />
      </Field>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Logo</p>
        <div className="flex items-center gap-4">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoUrl ? <img src={logoUrl} alt="Academy logo" className="max-h-full max-w-full object-contain" /> : <ImageUp className="size-5 text-subtle-foreground" aria-hidden />}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" loading={uploading} onClick={() => fileRef.current?.click()} data-testid="settings-logo-upload">
              {s.form.logoUploadId ? "Replace" : "Upload logo"}
            </Button>
            {s.form.logoUploadId ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => (setPreview(null), s.set({ logoUploadId: null }))}>
                Remove
              </Button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label="Logo file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </div>
        <p className="text-xs text-subtle-foreground">A square image works best. Without one, the generated mark is used.</p>
      </div>
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-medium" id="set-reg-label">Open registration</p>
          <p className="text-xs text-subtle-foreground">When off, nobody new can sign up. Existing learners can still sign in.</p>
        </div>
        <Switch checked={s.form.registration === "OPEN"} onCheckedChange={(c) => s.set({ registration: c ? "OPEN" : "CLOSED" })} aria-labelledby="set-reg-label" data-testid="settings-registration" />
      </div>
      <Field label="Support email" htmlFor="set-support" optional error={err(s.errors, "supportEmail")} hint="Shown on receipts and help pages.">
        <Input id="set-support" type="email" value={s.form.supportEmail} onChange={(e) => s.set({ supportEmail: e.target.value })} aria-invalid={inv(s.errors, "supportEmail")} data-testid="settings-support-email" />
      </Field>
    </SettingsSection>
  );
}

// ─── Currencies and payments ────────────────────────────────────────────────

const GATEWAYS: { value: Gateway; label: string }[] = [
  { value: "STRIPE", label: "Stripe" },
  { value: "RAZORPAY", label: "Razorpay" },
];

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function CurrencySection({ base }: { base: LmsSettings }) {
  const s = useSection(currencySection, base, ["currencies", "gateways"]);
  const [filter, setFilter] = useState("");
  const choices = useMemo(() => [...new Set([...s.form.enabled, ...CURRENCY_CHOICES])], [s.form.enabled]);
  const shown = choices.filter((c) => !filter || c.toLowerCase().includes(filter.toLowerCase()) || currencyName(c).toLowerCase().includes(filter.toLowerCase()));
  return (
    <SettingsSection id="currencies" title="Currencies and payments" description="Which currencies courses are priced in, and which payment provider takes each one." s={s}>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Enabled currencies</legend>
        <p className="text-xs text-subtle-foreground">Each course needs a price in a currency before it sells in it. Amounts are never converted.</p>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter currencies" aria-label="Filter currencies" className="h-9 sm:w-64" />
        <div className="grid max-h-64 grid-cols-1 gap-x-6 overflow-y-auto py-1 sm:grid-cols-2" data-testid="settings-currency-list">
          {shown.map((c) => (
            <label key={c} className="flex items-center gap-2.5 py-1.5 text-[14px]">
              <Checkbox checked={s.form.enabled.includes(c)} onCheckedChange={() => s.setForm((f) => toggleCurrency(f, c))} data-testid={`settings-currency-${c}`} />
              <span className="w-10 font-mono text-[13px] font-semibold">{c}</span>
              <span className="truncate text-muted-foreground">{currencyName(c)}</span>
            </label>
          ))}
        </div>
        {err(s.errors, "enabled") ? <p role="alert" className="text-xs font-medium text-danger">{err(s.errors, "enabled")}</p> : null}
      </fieldset>
      <Field label="Default currency" htmlFor="set-default-cur" error={err(s.errors, "default")} hint="Shown to visitors whose own currency is not offered.">
        <Select id="set-default-cur" value={s.form.default} onValueChange={(v) => s.set({ default: v })} options={s.form.enabled.map((c) => ({ value: c, label: `${c} · ${currencyName(c)}` }))} className="sm:w-72" data-testid="settings-default-currency" />
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-medium">Payment provider per currency</p>
        <ul className="divide-y divide-border border-y border-border">
          {s.form.enabled.map((c) => (
            <li key={c} className="flex items-center justify-between gap-4 py-2">
              <span className="text-[14px]">
                <span className="font-mono text-[13px] font-semibold">{c}</span> <span className="text-muted-foreground">{currencyName(c)}</span>
              </span>
              <Select
                value={s.form.routing[c] ?? s.form.fallback}
                onValueChange={(v) => s.set({ routing: { ...s.form.routing, [c]: v as Gateway } })}
                options={GATEWAYS}
                aria-label={`Payment provider for ${c}`}
                className="h-9 w-40"
                data-testid={`settings-gateway-${c}`}
              />
            </li>
          ))}
        </ul>
      </div>
      <Field label="Fallback provider" htmlFor="set-fallback" hint="Used for a currency with no provider set.">
        <Select id="set-fallback" value={s.form.fallback} onValueChange={(v) => s.set({ fallback: v as Gateway })} options={GATEWAYS} className="w-40" />
      </Field>
    </SettingsSection>
  );
}

// ─── Tax ────────────────────────────────────────────────────────────────────

function TaxSection({ base }: { base: LmsSettings }) {
  const s = useSection(taxSection, base, ["tax"]);
  const setRule = (i: number, patch: Partial<(typeof s.form.rules)[number]>) => s.set({ rules: s.form.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <SettingsSection id="tax" title="Tax" description="Sales tax added at checkout by the buyer's country. Use * for every other country." s={s}>
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-medium" id="set-tax-label">Charge tax</p>
          <p className="text-xs text-subtle-foreground">Invoices show the tax line and your seller details.</p>
        </div>
        <Switch checked={s.form.enabled} onCheckedChange={(c) => s.set({ enabled: c })} aria-labelledby="set-tax-label" data-testid="settings-tax-enabled" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium" id="set-tax-mode">Prices are</p>
        <UnderlineTabs
          size="sm"
          label="Prices are"
          value={s.form.mode}
          onChange={(v) => s.set({ mode: v })}
          tabs={[
            { value: "EXCLUSIVE", label: "Before tax (tax is added)" },
            { value: "INCLUSIVE", label: "Tax included" },
          ]}
        />
      </div>
      <div>
        <table className="w-full text-left text-[14px]" data-testid="settings-tax-rules">
          <caption className="sr-only">Tax rules</caption>
          <thead>
            <tr className="border-b border-border text-[12.5px] text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">Country</th>
              <th scope="col" className="py-2 pr-3 font-medium">Rate %</th>
              <th scope="col" className="py-2 pr-3 font-medium">Label</th>
              <th scope="col"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {s.form.rules.map((r, i) => (
              <tr key={i} className="border-b border-border align-top">
                <td className="py-2 pr-3">
                  <Input value={r.country} onChange={(e) => setRule(i, { country: e.target.value.toUpperCase() })} maxLength={2} aria-label={`Country for rule ${i + 1}`} aria-invalid={inv(s.errors, `rules.${i}.country`)} className="h-9 w-20 font-mono" placeholder="DE" data-testid={`tax-country-${i}`} />
                  {err(s.errors, `rules.${i}.country`) ? <p className="mt-1 text-xs text-danger">{err(s.errors, `rules.${i}.country`)}</p> : null}
                </td>
                <td className="py-2 pr-3">
                  <Input value={r.rate} onChange={(e) => setRule(i, { rate: e.target.value })} inputMode="decimal" aria-label={`Rate for rule ${i + 1}`} aria-invalid={inv(s.errors, `rules.${i}.rate`)} className="h-9 w-24" placeholder="19" data-testid={`tax-rate-${i}`} />
                  {err(s.errors, `rules.${i}.rate`) ? <p className="mt-1 text-xs text-danger">{err(s.errors, `rules.${i}.rate`)}</p> : null}
                </td>
                <td className="py-2 pr-3">
                  <Input value={r.label} onChange={(e) => setRule(i, { label: e.target.value })} maxLength={40} aria-label={`Label for rule ${i + 1}`} aria-invalid={inv(s.errors, `rules.${i}.label`)} className="h-9" placeholder="VAT" data-testid={`tax-label-${i}`} />
                  {err(s.errors, `rules.${i}.label`) ? <p className="mt-1 text-xs text-danger">{err(s.errors, `rules.${i}.label`)}</p> : null}
                </td>
                <td className="py-2 text-right">
                  <IconButton type="button" label={`Remove rule ${i + 1}`} variant="ghost" size="sm" onClick={() => s.set({ rules: s.form.rules.filter((_, j) => j !== i) })}>
                    <Trash2 />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!s.form.rules.length ? <p className="py-3 text-[13.5px] text-muted-foreground">No rules yet.</p> : null}
        {err(s.errors, "rules") ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{err(s.errors, "rules")}</p> : null}
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => s.set({ rules: [...s.form.rules, { country: "", rate: "", label: "" }] })} data-testid="tax-add-rule">
          <Plus /> Add rule
        </Button>
      </div>
    </SettingsSection>
  );
}

// ─── Seller, learning, certificates, analytics ──────────────────────────────

function SellerSection({ base }: { base: LmsSettings }) {
  const s = useSection(sellerSection, base, ["seller"]);
  return (
    <SettingsSection id="seller" title="Seller details" description="Printed on every invoice and credit note." s={s}>
      <Field label="Legal name" htmlFor="set-legal" error={err(s.errors, "legalName")}>
        <Input id="set-legal" value={s.form.legalName} onChange={(e) => s.set({ legalName: e.target.value })} aria-invalid={inv(s.errors, "legalName")} data-testid="settings-seller-name" />
      </Field>
      <Field label="Address" htmlFor="set-address" optional error={err(s.errors, "address")}>
        <Textarea id="set-address" rows={3} value={s.form.address} onChange={(e) => s.set({ address: e.target.value })} maxLength={500} aria-invalid={inv(s.errors, "address")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Tax ID" htmlFor="set-taxid" optional error={err(s.errors, "taxId")} hint="VAT, GSTIN or similar.">
          <Input id="set-taxid" value={s.form.taxId} onChange={(e) => s.set({ taxId: e.target.value })} maxLength={60} aria-invalid={inv(s.errors, "taxId")} />
        </Field>
        <Field label="Billing email" htmlFor="set-billing" optional error={err(s.errors, "email")}>
          <Input id="set-billing" type="email" value={s.form.email} onChange={(e) => s.set({ email: e.target.value })} aria-invalid={inv(s.errors, "email")} />
        </Field>
      </div>
    </SettingsSection>
  );
}

function NumberField({ id, label, hint, unit, value, onChange, error, testId }: { id: string; label: string; hint: string; unit: string; value: string; onChange: (v: string) => void; error?: string; testId?: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <div className="flex items-center gap-2">
        <Input id={id} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} className="w-24 tabular-nums" data-testid={testId} />
        <span className="text-[13.5px] text-muted-foreground">{unit}</span>
      </div>
    </Field>
  );
}

function LearningSection({ base }: { base: LmsSettings }) {
  const s = useSection(learningSection, base, ["learning"]);
  return (
    <SettingsSection id="learning" title="Learning" description="When lessons count as done, who can review, and how long payments stay open." s={s}>
      <div className="grid gap-5 sm:grid-cols-2">
        <NumberField id="set-video" label="A video is complete at" unit="% watched" hint="From 1 to 100." value={s.form.videoCompletePercent} onChange={(v) => s.set({ videoCompletePercent: v })} error={err(s.errors, "videoCompletePercent")} testId="settings-video-complete" />
        <NumberField id="set-review" label="Reviews open after" unit="% progress" hint="Learners leave a review once this far in." value={s.form.reviewMinProgressPercent} onChange={(v) => s.set({ reviewMinProgressPercent: v })} error={err(s.errors, "reviewMinProgressPercent")} testId="settings-review-min" />
        <NumberField id="set-grace" label="Grace after a failed renewal" unit="days" hint="Courses stay open while the card is retried. 0 to 30." value={s.form.subscriptionGraceDays} onChange={(v) => s.set({ subscriptionGraceDays: v })} error={err(s.errors, "subscriptionGraceDays")} testId="settings-grace" />
        <NumberField id="set-ttl" label="Unpaid orders expire after" unit="minutes" hint="From 5 to 1440." value={s.form.orderTtlMinutes} onChange={(v) => s.set({ orderTtlMinutes: v })} error={err(s.errors, "orderTtlMinutes")} testId="settings-order-ttl" />
      </div>
    </SettingsSection>
  );
}

function CertificatesSection({ base }: { base: LmsSettings }) {
  const s = useSection(certificatesSection, base, ["certificates"]);
  return (
    <SettingsSection id="certificates" title="Certificates" description="The signature and small print on every certificate issued from now on." s={s}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Signatory name" htmlFor="set-sig-name" optional error={err(s.errors, "signatoryName")}>
          <Input id="set-sig-name" value={s.form.signatoryName} onChange={(e) => s.set({ signatoryName: e.target.value })} maxLength={80} data-testid="settings-signatory" />
        </Field>
        <Field label="Signatory title" htmlFor="set-sig-title" optional error={err(s.errors, "signatoryTitle")}>
          <Input id="set-sig-title" value={s.form.signatoryTitle} onChange={(e) => s.set({ signatoryTitle: e.target.value })} maxLength={80} placeholder="Head of learning" />
        </Field>
      </div>
      <Field label="Footer" htmlFor="set-footer" optional error={err(s.errors, "footer")} hint={`${s.form.footer.length} of 300 characters.`}>
        <Textarea id="set-footer" rows={2} value={s.form.footer} onChange={(e) => s.set({ footer: e.target.value })} maxLength={300} />
      </Field>
    </SettingsSection>
  );
}

function AnalyticsSection({ base }: { base: LmsSettings }) {
  const s = useSection(analyticsSection, base, ["analytics"]);
  const zones = useMemo(() => timeZones(), []);
  const listId = useId();
  return (
    <SettingsSection id="analytics" title="Analytics" description="The time zone that decides where a day starts and ends in reports." s={s}>
      <Field label="Time zone" htmlFor="set-tz" error={err(s.errors, "timezone")} hint="Start typing a city or region.">
        <Input id="set-tz" list={listId} value={s.form.timezone} onChange={(e) => s.set({ timezone: e.target.value })} autoComplete="off" aria-invalid={inv(s.errors, "timezone")} className="sm:w-80" data-testid="settings-timezone" />
        <datalist id={listId}>
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </Field>
    </SettingsSection>
  );
}

// ─── Integrations ───────────────────────────────────────────────────────────

const MODE_COPY: Record<string, string> = { live: "Live", test: "Test mode", stub: "Stub (no real payments)", off: "Off" };

function Integrations() {
  const q = useQuery({ queryKey: qk.admin.detail("settings", "integrations"), queryFn: () => api().admin.integrations() });
  const [evsResult, setEvsResult] = useState<{ ok: boolean; message: string } | null>(null);
  const test = useMutation({ mutationFn: () => api().admin.testEvs(), meta: { silent: true }, onSuccess: setEvsResult, onError: (e) => setEvsResult({ ok: false, message: errorMessage(e) }) });
  const i: IntegrationStatus | undefined = q.data;
  const rows: { name: string; status: ReactNode; detail?: ReactNode; action?: ReactNode }[] = i
    ? [
        { name: "Stripe", status: MODE_COPY[i.stripe.mode], detail: i.stripe.configured ? (i.stripe.webhookConfigured ? "Webhook set up" : "Webhook not set up: payments will not confirm") : "Not configured" },
        { name: "Razorpay", status: MODE_COPY[i.razorpay.mode], detail: i.razorpay.configured ? (i.razorpay.webhookConfigured ? "Webhook set up" : "Webhook not set up: payments will not confirm") : "Not configured" },
        {
          name: "Video (EVS)",
          status: i.evs.configured ? "Connected" : "Off",
          detail: i.evs.configured ? [i.evs.baseUrl, i.evs.canListVideos ? "Can list videos" : "Cannot list videos"].filter(Boolean).join(" · ") : "Lectures use links or uploads only",
          action: i.evs.configured ? (
            <Button size="sm" variant="outline" loading={test.isPending} onClick={() => (setEvsResult(null), test.mutate())} data-testid="settings-test-evs">
              Test EVS connection
            </Button>
          ) : undefined,
        },
        { name: "AI assistance", status: i.ai.provider === "none" ? "Off" : i.ai.provider === "stub" ? "Stub" : i.ai.provider === "openai" ? "OpenAI" : "Gemini", detail: i.ai.model ?? undefined },
        { name: "Email", status: i.mail.mode === "outbox" ? "Outbox only (not sent)" : i.mail.mode === "smtp" ? "SMTP" : "Amazon SES" },
        { name: "File storage", status: i.storage.mode === "s3" ? "S3" : "Local disk" },
      ]
    : [];
  return (
    <section id="integrations" aria-labelledby="integrations-title" className="scroll-mt-24 border-t border-border py-8" data-testid="settings-integrations">
      <h2 id="integrations-title" className="font-display text-[20px] font-semibold tracking-[-0.015em]">Integrations</h2>
      <p className="mt-1 text-[14px] text-muted-foreground">Set by the server&apos;s environment. Keys and secrets are never shown here.</p>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : (
        <ul className="mt-5 divide-y divide-border border-y border-border">
          {!i
            ? [0, 1, 2, 3].map((k) => <li key={k} className="py-3"><Skeleton className="h-5 w-1/2" /></li>)
            : rows.map((r) => (
                <li key={r.name} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`integration-${r.name.split(" ")[0]!.toLowerCase()}`}>
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{r.name}</p>
                    {r.detail ? <p className="text-[12.5px] text-muted-foreground">{r.detail}</p> : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("text-[13.5px]", r.status === "Off" ? "text-subtle-foreground" : "text-foreground")}>{r.status}</span>
                    {r.action}
                  </div>
                </li>
              ))}
        </ul>
      )}
      <p aria-live="polite" className={cn("mt-3 text-[13.5px]", evsResult ? (evsResult.ok ? "text-success" : "text-danger") : "sr-only")} data-testid="settings-evs-result">
        {evsResult ? `${evsResult.ok ? "EVS answered: " : "EVS check failed: "}${evsResult.message}` : ""}
      </p>
    </section>
  );
}
