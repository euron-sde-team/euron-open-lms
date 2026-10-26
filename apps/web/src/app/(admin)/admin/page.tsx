import type { Metadata } from "next";
import { AdminOverview } from "@/components/admin/ops/overview";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return <AdminOverview />;
}
