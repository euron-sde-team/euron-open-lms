import type { Metadata } from "next";
import { AdminAudit } from "@/components/admin/ops/audit";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return <AdminAudit />;
}
