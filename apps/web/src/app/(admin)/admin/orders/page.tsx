import type { Metadata } from "next";
import { AdminOrders } from "@/components/admin/commerce/orders-page";

export const metadata: Metadata = { title: "Orders" };

export default function Page() {
  return <AdminOrders />;
}
