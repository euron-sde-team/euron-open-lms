"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Button, Field, Input, toast } from "@open-lms/ui";
import { api } from "@/lib/api";
import { useAuth, type SecondFactor } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { safeNext } from "@/lib/navigation";
import { AuthHeading, FormAlert } from "./auth-shell";
import { PasswordInput } from "./password-input";

const schema = z.object({
  login: z.string().trim().min(3, "Enter your email or username"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof schema>;

/** Shortest recovery code worth sending (the API decides what is valid). */
const RECOVERY_MIN = 6;

/** Login-specific copy: throttling is about attempts, not a locked account. */
export function loginErrorMessage(e: unknown): string {
  if (isApiError(e) && e.code === "RATE_LIMITED") return "Too many attempts. Try again in a few minutes.";
  if (isApiError(e) && e.code === "INVALID_RECOVERY_CODE") return "That recovery code did not work. Check it and try again, or use your authenticator app.";
  return errorMessage(e);
}

export function LoginForm() {
  const { login, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = useState<"password" | "totp">("password");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { login: "", password: "" } });

  useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);

  const attempt = async (values: Values, second?: SecondFactor) => {
    setBusy(true);
    setError(null);
    try {
      const r = await login(values.login, values.password, second);
      if (!r.ok) {
        setStep("totp");
        return;
      }
      router.replace(next);
    } catch (e) {
      setError({ code: isApiError(e) ? e.code : "ERROR", message: loginErrorMessage(e) });
      if (isApiError(e) && (e.code === "INVALID_TOTP" || e.code === "INVALID_RECOVERY_CODE")) setCode("");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    const value = form.getValues("login");
    if (!value.includes("@")) {
      toast.info({ title: "Enter your email address above to resend the link." });
      return;
    }
    try {
      await api().auth.resendVerification(value.trim().toLowerCase());
    } catch {
      /* the endpoint answers 202 either way; stay quiet */
    }
    setResent(true);
  };

  if (step === "totp") {
    const ready = useRecovery ? code.trim().length >= RECOVERY_MIN : code.length >= 6;
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void attempt(form.getValues(), useRecovery ? { recoveryCode: code.trim() } : code);
        }}
        noValidate
      >
        <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <ShieldCheck className="size-5" />
        </div>
        <AuthHeading
          title="Two-factor authentication"
          description={useRecovery ? "Enter one of the recovery codes you saved. Each code works once." : "Enter the 6 digit code from your authenticator app."}
        />
        {error ? <FormAlert>{error.message}</FormAlert> : null}
        {useRecovery ? (
          <Field label="Recovery code" htmlFor="recovery-code">
            <Input
              id="recovery-code"
              data-testid="recovery-code-input"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              maxLength={64}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="text-center font-mono tracking-wider"
              aria-invalid={error?.code === "INVALID_RECOVERY_CODE" || error?.code === "INVALID_TOTP" || undefined}
            />
          </Field>
        ) : (
          <Field label="Authentication code" htmlFor="totp">
            <Input
              id="totp"
              data-testid="totp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center text-lg tracking-[0.4em]"
              aria-invalid={error?.code === "INVALID_TOTP" || undefined}
            />
          </Field>
        )}
        <button
          type="button"
          className="mt-2 text-sm font-medium text-link hover:underline"
          data-testid="recovery-toggle"
          onClick={() => {
            setUseRecovery((v) => !v);
            setCode("");
            setError(null);
          }}
        >
          {useRecovery ? "Use your authenticator app" : "Use a recovery code"}
        </button>
        <Button type="submit" block size="lg" className="mt-5" loading={busy} disabled={!ready} data-testid="login-submit">
          Verify
        </Button>
        <Button
          variant="ghost"
          block
          className="mt-2"
          onClick={() => {
            setStep("password");
            setUseRecovery(false);
            setCode("");
            setError(null);
          }}
        >
          <ArrowLeft /> Back
        </Button>
      </form>
    );
  }

  const errs = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => attempt(v))} noValidate>
      <AuthHeading title="Sign in" description="Pick up your courses where you left off." />
      {error ? (
        <FormAlert>
          {error.message}
          {error.code === "EMAIL_NOT_VERIFIED" ? (
            <span className="mt-1 block">
              {resent ? (
                "If that address has an account, a new link is on its way."
              ) : (
                <button type="button" onClick={() => void resend()} className="font-semibold underline">
                  Resend the verification email
                </button>
              )}
            </span>
          ) : null}
        </FormAlert>
      ) : null}
      <div className="space-y-4">
        <Field label="Email or username" htmlFor="login" error={errs.login?.message}>
          <Input id="login" autoComplete="username" autoFocus aria-invalid={!!errs.login || undefined} {...form.register("login")} />
        </Field>
        <Field label="Password" htmlFor="password" error={errs.password?.message}>
          <PasswordInput id="password" autoComplete="current-password" aria-invalid={!!errs.password || undefined} {...form.register("password")} />
        </Field>
      </div>
      <div className="mt-2 text-right">
        <Link href="/forgot-password" className="text-sm font-medium text-link hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" block size="lg" className="mt-4" loading={busy} data-testid="login-submit">
        Sign in
      </Button>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link href={next !== "/" ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-semibold text-link hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
