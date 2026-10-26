import type { Metadata } from "next";
import { AdminCoupons } from "@/components/admin/commerce/coupons-page";

export const metadata: Metadata = { title: "Coupons" };

export default function Page() {
  return <AdminCoupons />;
}
