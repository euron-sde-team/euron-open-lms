"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MailWarning } from "lucide-react";
import { Button, Field, Input, Spinner, toast } from "@open-lms/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { takeAfterVerify } from "@/lib/navigation";
import { AuthHeading } from "./auth-shell";

export function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const { acceptSession } = useAuth();
  const [state, setState] = useState<"working" | "failed">(token ? "working" : "failed");
  const [error, setError] = useState<string>(token ? "" : "This link is missing its token.");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const once = useRef(false);

  useEffect(() => {
    if (!token || once.current) return;
    once.current = true;
    api()
      .auth.verifyEmail(token)
      .then((r) => {
        acceptSession(r);
        toast.success({ title: "Email confirmed", description: "Your account is ready." });
        router.replace(takeAfterVerify());
      })
      .catch((e) => {
        setError(errorMessage(e));
        setState("failed");
      });
  }, [token, acceptSession, router]);

  if (state === "working") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Spinner size="lg" />
        <p className="text-sm text-muted-foreground">Confirming your email...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-warning-soft text-warning-soft-foreground">
        <MailWarning className="size-5" />
      </div>
      <AuthHeading title="That link did not work" description={error || "The link may have expired or already been used."} />
      {sent ? (
        <p className="text-sm text-muted-foreground">If that address has an account waiting for confirmation, a new link is on its way.</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!email.includes("@")) return;
            try {
              await api().auth.resendVerification(email.trim().toLowerCase());
            } catch {
              /* 202 either way */
            }
            setSent(true);
          }}
        >
          <Field label="Email" htmlFor="resend-email">
            <Input id="resend-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Button type="submit" block className="mt-4" disabled={!email.includes("@")}>
            Send a new link
          </Button>
        </form>
      )}
      <p className="mt-5 text-center text-sm">
        <Link href="/login" className="font-semibold text-link hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
