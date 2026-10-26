"use client";

import type { ReactNode } from "react";
import type { AdminArea } from "@open-lms/types";
import { ForbiddenArea } from "./forbidden";
import { useAdminSession } from "./session";

/** Renders children only when the session may open `area` (else the friendly 403). */
export function AreaGate({ area, children }: { area: AdminArea; children: ReactNode }) {
  const s = useAdminSession();
  if (!s.can(area)) return <ForbiddenArea homeHref="/admin" homeLabel="Back to the overview" />;
  return <>{children}</>;
}
