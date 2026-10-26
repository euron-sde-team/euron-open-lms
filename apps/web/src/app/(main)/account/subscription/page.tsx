import type { Metadata } from "next";
import { SubscriptionSection } from "@/components/account/subscription-section";

export const metadata: Metadata = { title: "Subscription" };

export default function Page() {
  return <SubscriptionSection />;
}
