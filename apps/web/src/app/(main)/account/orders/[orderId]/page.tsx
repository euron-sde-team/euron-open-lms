import type { Metadata } from "next";
import { OrderDetailSection } from "@/components/account/order-detail-section";

export const metadata: Metadata = { title: "Order" };

export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <OrderDetailSection orderId={orderId} />;
}
