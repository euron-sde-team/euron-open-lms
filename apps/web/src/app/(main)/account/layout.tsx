import type { Metadata } from "next";
import { AccountShell } from "@/components/account/account-shell";
import { RequireAuth } from "@/components/common/require-auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AccountShell>{children}</AccountShell>
    </RequireAuth>
  );
}
