import type { Metadata } from "next";
import { OrdersSection } from "@/components/account/orders-section";

export const metadata: Metadata = { title: "Orders" };

export default function Page() {
  return <OrdersSection />;
}
