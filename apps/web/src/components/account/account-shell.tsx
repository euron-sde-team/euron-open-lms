"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NativeSelect, cn } from "@open-lms/ui";
import { Page } from "@/components/shell/layouts";
import { useMe } from "@/lib/auth";
import { dateOnly } from "@/lib/billing";

export const ACCOUNT_SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "orders", label: "Orders" },
  { id: "subscription", label: "Subscription" },
  { id: "privacy", label: "Privacy and data" },
] as const;

export type AccountSectionId = (typeof ACCOUNT_SECTIONS)[number]["id"];

/** The section a path belongs to ("/account/orders/123" is Orders). */
export function sectionOf(pathname: string | null | undefined): AccountSectionId {
  const seg = (pathname ?? "").split("/")[2] ?? "";
  return (ACCOUNT_SECTIONS.find((s) => s.id === seg)?.id ?? "profile") as AccountSectionId;
}

/** Days an account deletion waits before the data is erased (users.routes.ts). */
export const DELETION_GRACE_DAYS = 14;

export function AccountShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const active = sectionOf(pathname);
  const purgeOn = me.deletionRequestedAt ? new Date(new Date(me.deletionRequestedAt).getTime() + DELETION_GRACE_DAYS * 86_400_000).toISOString() : null;
  return (
    <Page>
      {purgeOn ? (
        <div role="status" className="mb-6 border-l-2 border-danger pl-4 text-[14.5px]" data-testid="deletion-pending">
          <p className="font-semibold">This account is scheduled for deletion</p>
          <p className="mt-0.5 text-muted-foreground">
            You asked to delete it on {dateOnly(me.deletionRequestedAt)}. It will be erased after {dateOnly(purgeOn)} unless you cancel by signing in again.
          </p>
        </div>
      ) : null}
      <p className="mb-6 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-primary">Account</p>
      <div className="flex flex-col gap-8 md:flex-row md:gap-12">
        <nav aria-label="Account sections" className="md:w-52 md:shrink-0">
          <label htmlFor="account-section-select" className="sr-only">
            Section
          </label>
          <NativeSelect id="account-section-select" className="md:hidden" value={active} onChange={(e) => router.push(`/account/${e.target.value}`)} data-testid="account-nav-select">
            {ACCOUNT_SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
          <ul className="hidden md:block">
            {ACCOUNT_SECTIONS.map((s) => {
              const on = s.id === active;
              return (
                <li key={s.id}>
                  <Link
                    href={`/account/${s.id}`}
                    aria-current={on ? "page" : undefined}
                    data-testid={`account-nav-${s.id}`}
                    className={cn(
                      "relative block py-2 pl-4 text-[14.5px] font-medium transition-colors",
                      on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span aria-hidden className={cn("absolute inset-y-1.5 left-0 w-0.5 rounded-full", on ? "bg-ink" : "bg-transparent")} />
                    {s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 md:max-w-[760px]">{children}</div>
      </div>
    </Page>
  );
}
