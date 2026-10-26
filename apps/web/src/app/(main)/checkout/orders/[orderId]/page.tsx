import type { Metadata } from "next";
import { OrderStatusPage } from "@/components/checkout/order-status-page";
import { RequireAuth } from "@/components/common/require-auth";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return (
    <RequireAuth>
      <OrderStatusPage orderId={orderId} />
    </RequireAuth>
  );
}
