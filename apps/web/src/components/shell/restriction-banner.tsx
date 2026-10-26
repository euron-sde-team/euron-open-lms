"use client";

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isRestricted, restrictionMessage } from "@/lib/restriction";

/** Persistent while the account is suspended: the app stays readable, composers are disabled. */
export function RestrictionBanner() {
  const { user } = useAuth();
  if (!user || !isRestricted(user)) return null;
  const until = user.suspendedUntil;
  return (
    <div role="status" data-testid="restriction-banner" className="border-b border-warning/30 bg-warning-soft text-warning-soft-foreground">
      <div className="mx-auto flex max-w-[1200px] items-start gap-2 px-4 py-2.5 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">{restrictionMessage(until)}</span> You can keep learning, but reviews, questions and answers are off.{" "}
          <Link href="/account" className="font-semibold underline">
            Account
          </Link>
        </p>
      </div>
    </div>
  );
}
