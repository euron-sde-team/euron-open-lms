import type { Metadata } from "next";
import { AdminSettings } from "@/components/admin/ops/settings";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <AdminSettings />;
}
