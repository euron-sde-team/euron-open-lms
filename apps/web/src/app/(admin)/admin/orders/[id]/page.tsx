import type { Metadata } from "next";
import { AdminOrderDetail } from "@/components/admin/commerce/order-detail";

export const metadata: Metadata = { title: "Order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminOrderDetail id={id} />;
}
