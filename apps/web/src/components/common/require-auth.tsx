"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Spinner } from "@open-lms/ui";
import { useAuth } from "@/lib/auth";

export function FullPageSpinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

/** Renders children only when signed in; otherwise sends the person to sign in and back. */
export function RequireAuth({ children, role }: { children: ReactNode; role?: "staff" | "admin" }) {
  const { status, isStaff, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    // Keep the query string too (a checkout link carries the item), read at redirect time.
    if (status === "signed-out") router.replace(`/login?next=${encodeURIComponent(`${pathname || "/"}${typeof window !== "undefined" ? window.location.search : ""}`)}`);
  }, [status, router, pathname]);
  if (status !== "signed-in") return <FullPageSpinner />;
  if (role === "admin" && !isAdmin) return <Forbidden />;
  if (role === "staff" && !isStaff) return <Forbidden />;
  return <>{children}</>;
}

function Forbidden() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-lg font-semibold">This area is for academy staff</p>
      <p className="mt-1 text-sm text-muted-foreground">Ask an administrator if you think you should have access.</p>
    </div>
  );
}
