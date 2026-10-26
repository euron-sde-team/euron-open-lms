import type { Metadata } from "next";
import { AdminStaff } from "@/components/admin/ops/staff";

export const metadata: Metadata = { title: "Staff" };

export default function Page() {
  return <AdminStaff />;
}
