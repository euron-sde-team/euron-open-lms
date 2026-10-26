import type { Metadata } from "next";
import { PlansPage } from "@/components/plans/plans-page";

export const metadata: Metadata = { title: "Plans", description: "One subscription for every course in the plan. Cancel any time." };

export default function Page() {
  return <PlansPage />;
}
