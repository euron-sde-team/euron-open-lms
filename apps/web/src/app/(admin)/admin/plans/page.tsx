import type { Metadata } from "next";
import { AdminPlans } from "@/components/admin/commerce/plans-page";

export const metadata: Metadata = { title: "Plans and bundles" };

export default function Page() {
  return <AdminPlans />;
}
