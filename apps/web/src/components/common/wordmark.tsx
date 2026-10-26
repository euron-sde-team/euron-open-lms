"use client";

import Link from "next/link";
import { cn } from "@open-lms/ui";
import { useProductName } from "@/lib/meta";

/** Split for the two-tone wordmark: all but the last word strong, the last word muted. */
export function splitName(name: string): { lead: string; tail: string } {
  const t = name.trim();
  const i = t.lastIndexOf(" ");
  return i < 0 ? { lead: t, tail: "" } : { lead: t.slice(0, i), tail: t.slice(i + 1) };
}

export function LogoMark({ className }: { className?: string }) {
  // An open book whose pages rise into a spark: learning that compounds.
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-ink" />
      <path d="M7 11.2c3.2-.9 6.2-.4 9 1.6v11c-2.8-2-5.8-2.5-9-1.6z" className="fill-brand" />
      <path d="M25 11.2c-3.2-.9-6.2-.4-9 1.6v11c2.8-2 5.8-2.5 9-1.6z" fill="white" fillOpacity="0.92" />
      <path d="M16 5.2l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z" fill="white" />
    </svg>
  );
}

export function Wordmark({ compact, className, textClassName }: { compact?: boolean; className?: string; textClassName?: string }) {
  const name = useProductName();
  const { lead, tail } = splitName(name);
  return (
    <Link href="/" className={cn("flex min-w-0 items-center gap-2 rounded-md focus-visible:ring-2", className)} aria-label={`${name} home`}>
      <LogoMark />
      {compact ? null : (
        <span className={cn("truncate font-display text-[17px] font-semibold tracking-[-0.02em] text-foreground", textClassName)}>
          {lead}
          {tail ? <span className="font-semibold text-muted-foreground"> {tail}</span> : null}
        </span>
      )}
    </Link>
  );
}
