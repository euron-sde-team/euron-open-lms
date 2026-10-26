"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import { Button, Field, Input } from "@open-lms/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { AuthHeading, FormAlert } from "./auth-shell";

const schema = z.object({ email: z.string().trim().email("Enter a valid email address") });

export function ForgotPassword() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  if (done) {
    return (
      <div className="text-center" data-testid="forgot-sent">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <MailCheck className="size-6" />
        </div>
        <AuthHeading title="Check your email" description="If an account exists for that address, we sent a link to reset your password. It expires soon, so use it shortly." />
        <Link href="/login" className="text-sm font-semibold text-link hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async ({ email }) => {
        setError(null);
        try {
          await api().auth.forgotPassword(email.toLowerCase());
          setDone(true);
        } catch (e) {
          // Only transport and rate-limit problems are worth showing; never reveal whether the account exists.
          if (isApiError(e) && (e.status === 0 || e.status === 429 || e.status >= 500)) setError(errorMessage(e));
          else setDone(true);
        }
      })}
    >
      <AuthHeading title="Reset your password" description="Enter the email you signed up with and we will send you a reset link." />
      {error ? <FormAlert>{error}</FormAlert> : null}
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus {...form.register("email")} />
      </Field>
      <Button type="submit" block size="lg" className="mt-5" loading={form.formState.isSubmitting} data-testid="forgot-submit">
        Send reset link
      </Button>
      <p className="mt-5 text-center text-sm">
        <Link href="/login" className="font-semibold text-link hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
