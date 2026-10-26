"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Copy, Download, LogOut } from "lucide-react";
import { isApiError, type SessionInfo } from "@open-lms/api-client";
import { Badge, Button, Checkbox, Field, Input, Skeleton, toast } from "@open-lms/ui";
import { PasswordInput, StrengthMeter } from "@/components/auth/password-input";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { summarizeUserAgent } from "@/lib/admin";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { useProductName } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { relativeTime } from "@/lib/time";
import { AccountSection, SectionTitle } from "./section";

export function SecuritySection() {
  return (
    <div>
      <SectionTitle title="Security" lead="Your password, two-factor sign-in and the devices signed in to your account." />
      <PasswordBlock />
      <TwoFactorBlock />
      <SessionsBlock />
    </div>
  );
}

// ─── Password ───────────────────────────────────────────────────────────────

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(10, "Use at least 10 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "The passwords do not match" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Choose a different password from your current one" });
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordBlock() {
  const { logout } = useAuth();
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });
  const errs = form.formState.errors;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        try {
          await api().auth.changePassword(v.currentPassword, v.newPassword);
          // The API ends every session (this one too) when the password changes.
          toast.success({ title: "Password changed. Sign in again", description: "Every device was signed out." });
          await logout();
        } catch (e) {
          if (isApiError(e) && e.code === "INVALID_CREDENTIALS") form.setError("currentPassword", { message: "That is not your current password." });
          else if (isApiError(e) && e.code === "WEAK_PASSWORD") form.setError("newPassword", { message: errorMessage(e) });
          else toast.error({ title: errorMessage(e) });
        }
      })}
    >
      <AccountSection
        className="last:border-b"
        title="Password"
        description="After a change you are signed out everywhere and sign in again with the new password."
        actions={
          <Button type="submit" variant="outline" loading={form.formState.isSubmitting} data-testid="password-save">
            Change password
          </Button>
        }
      >
        <div className="max-w-sm space-y-4">
          <Field label="Current password" htmlFor="currentPassword" error={errs.currentPassword?.message}>
            <PasswordInput id="currentPassword" autoComplete="current-password" {...form.register("currentPassword")} />
          </Field>
          <Field label="New password" htmlFor="newPassword" error={errs.newPassword?.message}>
            <PasswordInput id="newPassword" autoComplete="new-password" {...form.register("newPassword")} />
            {!errs.newPassword ? <StrengthMeter value={form.watch("newPassword")} /> : null}
          </Field>
          <Field label="Confirm new password" htmlFor="confirm" error={errs.confirm?.message}>
            <PasswordInput id="confirm" autoComplete="new-password" {...form.register("confirm")} />
          </Field>
        </div>
      </AccountSection>
    </form>
  );
}

// ─── Two-factor ─────────────────────────────────────────────────────────────

const codeError = (e: unknown) =>
  isApiError(e) && e.code === "INVALID_CREDENTIALS" ? "That password is not right." : isApiError(e) && e.code === "INVALID_TOTP" ? "That code did not match. Codes change every 30 seconds." : errorMessage(e);

function CodeInput({ id, value, onChange, testId }: { id: string; value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="max-w-[160px] text-center tracking-[0.3em]"
      data-testid={testId}
    />
  );
}

function TwoFactorBlock() {
  const me = useMe();
  const { reloadMe } = useAuth();
  const name = useProductName();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (!setup) return;
    let alive = true;
    QRCode.toDataURL(setup.otpauthUrl, { margin: 2, width: 200, errorCorrectionLevel: "M" })
      .then((d) => alive && setQr(d))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [setup]);

  const start = useMutation({ mutationFn: () => api().auth.totpSetup(), onSuccess: (s) => setSetup(s) });
  const enable = useMutation({
    mutationFn: () => api().auth.totpEnable(code),
    meta: { silent: true },
    onSuccess: async (r) => {
      setSetup(null);
      setQr(null);
      setCode("");
      setRecoveryCodes(r?.recoveryCodes?.length ? r.recoveryCodes : null);
      await reloadMe().catch(() => undefined);
      toast.success({ title: "Two-factor sign-in is on" });
    },
    onError: (e) => setError(codeError(e)),
  });
  const disable = useMutation({
    mutationFn: () => api().auth.totpDisable(password, confirmCode),
    meta: { silent: true },
    onSuccess: async () => {
      setPassword("");
      setConfirmCode("");
      setError(null);
      await reloadMe().catch(() => undefined);
      toast.success({ title: "Two-factor sign-in is off" });
    },
    onError: (e) => setError(codeError(e)),
  });
  const regenerate = useMutation({
    mutationFn: () => api().auth.totpRecoveryCodes(password, confirmCode),
    meta: { silent: true },
    onSuccess: (r) => {
      setPassword("");
      setConfirmCode("");
      setError(null);
      setRecoveryCodes(r.recoveryCodes);
    },
    onError: (e) => setError(codeError(e)),
  });

  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} productName={name} onDone={() => setRecoveryCodes(null)} />;

  if (me.totpEnabled) {
    const confirmed = !!password && confirmCode.length === 6;
    return (
      <AccountSection
        title={
          <span className="flex items-center gap-2">
            Two-factor sign-in <Badge tone="success">On</Badge>
          </span>
        }
        description="Signing in asks for a code from your authenticator app. To turn it off or replace your recovery codes, confirm your password and a current code."
        testId="totp-on"
        actions={
          <>
            <Button variant="outline" onClick={() => regenerate.mutate()} disabled={!confirmed || disable.isPending} loading={regenerate.isPending} data-testid="totp-regenerate">
              New recovery codes
            </Button>
            <Button variant="danger-ghost" onClick={() => disable.mutate()} disabled={!confirmed || regenerate.isPending} loading={disable.isPending} data-testid="totp-disable">
              Turn off
            </Button>
          </>
        }
      >
        <div className="max-w-sm space-y-4">
          <Field label="Password" htmlFor="totp-password">
            <PasswordInput id="totp-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="6 digit code from your app" htmlFor="totp-confirm-code" error={error}>
            <CodeInput id="totp-confirm-code" value={confirmCode} onChange={(v) => { setError(null); setConfirmCode(v); }} testId="totp-confirm-code" />
          </Field>
        </div>
      </AccountSection>
    );
  }

  if (!setup) {
    return (
      <AccountSection
        title={
          <span className="flex items-center gap-2">
            Two-factor sign-in <Badge>Off</Badge>
          </span>
        }
        description="Add a code from an authenticator app to every sign-in, so a stolen password is not enough."
        actions={
          <Button variant="outline" onClick={() => start.mutate()} loading={start.isPending} data-testid="totp-start">
            Set up two-factor
          </Button>
        }
      />
    );
  }

  return (
    <AccountSection
      title="Set up two-factor sign-in"
      description="Scan the code with an authenticator app, then enter the 6 digit code it shows."
      testId="totp-setup"
      actions={
        <>
          <Button onClick={() => enable.mutate()} disabled={code.length !== 6} loading={enable.isPending} data-testid="totp-enable">
            Turn on
          </Button>
          <Button variant="ghost" onClick={() => { setSetup(null); setCode(""); setError(null); }}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="shrink-0">
          {qr ? (
            // A data URL with its own light quiet zone, so it scans in dark mode too.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded-lg" data-testid="totp-qr" />
          ) : (
            <Skeleton className="size-[180px]" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <p className="text-sm font-medium">Cannot scan? Enter this key</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-sm" data-testid="totp-secret">{setup.secret}</code>
              <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast.success({ title: "Key copied" }), () => undefined)}>
                <Copy /> Copy
              </Button>
            </div>
          </div>
          <Field label="6 digit code" htmlFor="totp-code" error={error}>
            <CodeInput id="totp-code" value={code} onChange={(v) => { setError(null); setCode(v); }} testId="totp-code" />
          </Field>
        </div>
      </div>
    </AccountSection>
  );
}

/** The plain-text file a learner saves: one code per line under a short header. */
export function recoveryCodesText(codes: string[], productName: string): string {
  return [`${productName} recovery codes`, "Each code signs you in once if you lose your authenticator app.", "", ...codes, ""].join("\n");
}

/** Shown once, right after the API returns the codes; Done unlocks after "I saved them". */
export function RecoveryCodes({ codes, productName, onDone }: { codes: string[]; productName: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = recoveryCodesText(codes, productName);
  return (
    <AccountSection
      title="Save your recovery codes"
      description="If you lose your authenticator app, each code signs you in once. They are not shown again."
      testId="recovery-panel"
      actions={
        <Button onClick={onDone} disabled={!saved} data-testid="recovery-done">
          Done
        </Button>
      }
    >
      <ul className="grid max-w-[480px] grid-cols-2 gap-x-6 gap-y-2 border-y border-border py-4 font-mono text-[14px] tabular-nums sm:grid-cols-3" data-testid="recovery-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" data-testid="recovery-copy" onClick={() => navigator.clipboard?.writeText(codes.join("\n")).then(() => toast.success({ title: "Codes copied" }), () => undefined)}>
          <Copy /> Copy
        </Button>
        <Button variant="outline" size="sm" data-testid="recovery-download" onClick={() => saveBlob(new Blob([text], { type: "text/plain" }), "recovery-codes.txt")}>
          <Download /> Download
        </Button>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} data-testid="recovery-saved" aria-label="I saved them" />
        <span>I saved them somewhere safe</span>
      </label>
    </AccountSection>
  );
}

// ─── Sessions ───────────────────────────────────────────────────────────────

function SessionsBlock() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [confirmAll, setConfirmAll] = useState(false);
  const q = useQuery({ queryKey: qk.sessions, queryFn: () => api().users.sessions() });
  const revoke = useMutation({
    mutationFn: (id: string) => api().users.revokeSession(id),
    onMutate: (id) => {
      const prev = qc.getQueryData<SessionInfo[]>(qk.sessions);
      qc.setQueryData<SessionInfo[]>(qk.sessions, (s) => s?.filter((x) => x.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(qk.sessions, ctx?.prev),
    onSuccess: () => toast.success({ title: "That device was signed out" }),
  });
  const sessions = [...(q.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current));

  return (
    <AccountSection
      title="Where you are signed in"
      description="Sign out any device you do not recognise, then change your password."
      actions={
        <Button variant="outline" onClick={() => setConfirmAll(true)} data-testid="sessions-sign-out-all">
          <LogOut /> Sign out everywhere
        </Button>
      }
    >
      {q.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : (
        <ul className="divide-y divide-border border-y border-border" data-testid="sessions-list">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[14.5px] font-semibold">
                  {summarizeUserAgent(s.userAgent)}
                  {s.current ? <Badge tone="success">This device</Badge> : null}
                </p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {[s.ip, s.lastUsedAt ? `Active ${relativeTime(s.lastUsedAt)}` : `Signed in ${relativeTime(s.createdAt)}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              {!s.current ? (
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)} data-testid="session-revoke">
                  Sign out
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out everywhere?"
        description="Every device, including this one, is signed out. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        onConfirm={() => logout({ everywhere: true })}
      />
    </AccountSection>
  );
}
