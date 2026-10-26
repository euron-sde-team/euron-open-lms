"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2 } from "lucide-react";
import { Button, Field } from "@open-lms/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { AuthHeading, FormAlert } from "./auth-shell";
import { PasswordInput, StrengthMeter } from "./password-input";

const schema = z
  .object({ password: z.string().min(10, "Use at least 10 characters").max(128), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords do not match" });

export function ResetPassword() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "This link is missing its token. Request a new one.");
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: "", confirm: "" } });
  const pw = form.watch("password");

  if (done) {
    return (
      <div className="text-center" data-testid="reset-done">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success-soft text-success-soft-foreground">
          <CheckCircle2 className="size-6" />
        </div>
        <AuthHeading title="Password updated" description="You can now sign in with your new password. Other sessions were signed out." />
        <Button asChild block size="lg">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }
  const errs = form.formState.errors;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await api().auth.resetPassword(token, v.password);
          setDone(true);
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
    >
      <AuthHeading title="Choose a new password" />
      {error ? (
        <FormAlert>
          {error}{" "}
          <Link href="/forgot-password" className="font-semibold underline">
            Request a new link
          </Link>
        </FormAlert>
      ) : null}
      <div className="space-y-4">
        <Field label="New password" htmlFor="password" error={errs.password?.message}>
          <PasswordInput id="password" autoComplete="new-password" autoFocus {...form.register("password")} />
          {!errs.password ? <StrengthMeter value={pw} /> : null}
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={errs.confirm?.message}>
          <PasswordInput id="confirm" autoComplete="new-password" {...form.register("confirm")} />
        </Field>
      </div>
      <Button type="submit" block size="lg" className="mt-6" disabled={!token} loading={form.formState.isSubmitting} data-testid="reset-submit">
        Update password
      </Button>
    </form>
  );
}
