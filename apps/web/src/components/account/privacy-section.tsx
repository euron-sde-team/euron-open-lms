"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { isApiError } from "@open-lms/api-client";
import type { SubscriptionSummary } from "@open-lms/types";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, toast } from "@open-lms/ui";
import { FormAlert } from "@/components/auth/auth-shell";
import { PasswordInput } from "@/components/auth/password-input";
import { exportErrorMessage } from "@/lib/account";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { exportFileName, saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";
import { DELETION_GRACE_DAYS } from "./account-shell";
import { AccountSection, SectionTitle } from "./section";

/** A subscription that still renews blocks deletion (409 SUBSCRIPTION_ACTIVE). */
export function blocksDeletion(sub: Pick<SubscriptionSummary, "status" | "cancelAtPeriodEnd"> | null | undefined): boolean {
  return !!sub && ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE"].includes(sub.status) && !sub.cancelAtPeriodEnd;
}

export function PrivacySection() {
  const me = useMe();
  const [deleting, setDeleting] = useState(false);
  const download = useMutation({
    mutationFn: () => api().users.exportData(),
    meta: { silent: true },
    onSuccess: (blob) => saveBlob(blob, exportFileName(me.username)),
    onError: (e) => toast.error({ title: exportErrorMessage(e, errorMessage) }),
  });
  return (
    <div>
      <SectionTitle title="Privacy and data" lead="Take a copy of your data, or delete your account." />
      <AccountSection
        title="Download your data"
        description="A JSON file with what your account holds: your profile, learning progress, notes, submissions, posts and orders. You can export 3 times a day."
        actions={
          <Button variant="outline" onClick={() => download.mutate()} loading={download.isPending} data-testid="export-data">
            <Download /> Download my data
          </Button>
        }
      />
      <AccountSection
        title="Delete account"
        description={`You are signed out everywhere at once. Your data is erased for good after ${DELETION_GRACE_DAYS} days; signing in before then cancels the deletion.`}
        actions={
          <Button variant="danger-ghost" onClick={() => setDeleting(true)} data-testid="delete-account">
            Delete account
          </Button>
        }
      >
        {blocksDeletion(me.subscription) ? (
          <p className="text-[14px] text-muted-foreground">
            You have a plan. Cancel it in{" "}
            <Link href="/account/subscription" className="font-medium text-link hover:underline">
              Subscription
            </Link>{" "}
            first. It can run until the end of the period you paid for.
          </p>
        ) : null}
      </AccountSection>
      {deleting ? <DeleteAccountDialog onClose={() => setDeleting(false)} /> : null}
    </div>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const { logout } = useAuth();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<React.ReactNode>(null);
  const ready = typed.trim() === me.username && !!password && (!me.totpEnabled || totp.length === 6);
  const del = useMutation({
    mutationFn: () => api().users.deleteMe({ password, ...(me.totpEnabled ? { totp } : {}) }),
    meta: { silent: true },
    onSuccess: async () => {
      await logout({ silent: true });
      router.replace("/goodbye");
    },
    onError: (e) => {
      if (isApiError(e) && e.code === "INVALID_CREDENTIALS") setError("That password is not right.");
      else if (isApiError(e) && e.code === "INVALID_TOTP") setError("That code did not match. Codes change every 30 seconds.");
      else if (isApiError(e) && e.code === "SUBSCRIPTION_ACTIVE")
        setError(
          <>
            You still have a live plan.{" "}
            <Link href="/account/subscription" className="font-semibold underline" onClick={onClose}>
              Cancel it first
            </Link>
            (it keeps running until the period ends), then delete your account.
          </>,
        );
      else setError(errorMessage(e));
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent size="sm" data-testid="delete-account-dialog">
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            After {DELETION_GRACE_DAYS} days your notes, quiz answers, submissions and certificates are erased. Orders are kept for accounting without your name. Reviews and answers you posted stay, shown under &quot;Deleted user&quot;.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {error ? <FormAlert>{error}</FormAlert> : null}
          <Field label={<>Type your username <span className="font-mono">{me.username}</span> to confirm</>} htmlFor="delete-confirm">
            <Input id="delete-confirm" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="delete-confirm-username" />
          </Field>
          <Field label="Password" htmlFor="delete-password">
            <PasswordInput id="delete-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="delete-password" />
          </Field>
          {me.totpEnabled ? (
            <Field label="6 digit code from your app" htmlFor="delete-totp">
              <Input
                id="delete-totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="max-w-[160px] text-center tracking-[0.3em]"
                data-testid="delete-totp"
              />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={del.isPending}>
            Keep my account
          </Button>
          <Button variant="danger" onClick={() => del.mutate()} disabled={!ready} loading={del.isPending} data-testid="delete-account-confirm">
            Delete account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
