"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { isApiError } from "@open-lms/api-client";
import type { AdminArea, AdminSession } from "@open-lms/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/query-keys";

/** GET /admin/me as a query (the shell loads it once; pages read it from context). */
export function useAdminSessionQuery() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.admin.session,
    queryFn: ({ signal }) => api().admin.me(signal),
    enabled: status === "signed-in",
    staleTime: 5 * 60_000,
    retry: (n, e) => !(isApiError(e) && e.status > 0 && e.status < 500) && n < 2,
    meta: { silent: true },
  });
}

export interface AdminViewer extends AdminSession {
  /** May the operator open this area? */
  can: (area: AdminArea) => boolean;
  isAdmin: boolean;
  isInstructor: boolean;
}

export function toViewer(s: AdminSession): AdminViewer {
  return { ...s, can: (a) => !!s.permissions[a], isAdmin: s.role === "ADMIN", isInstructor: s.role === "INSTRUCTOR" };
}

const Ctx = createContext<AdminViewer | null>(null);

export function AdminSessionProvider({ session, children }: { session: AdminSession; children: ReactNode }) {
  const value = useMemo(() => toViewer(session), [session]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The operator session inside /admin (the layout guarantees it is loaded). */
export function useAdminSession(): AdminViewer {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdminSession must be used inside the /admin layout");
  return v;
}
