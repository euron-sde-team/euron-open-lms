import type { Metadata } from "next";
import { SecuritySection } from "@/components/account/security-section";

export const metadata: Metadata = { title: "Security" };

export default function Page() {
  return <SecuritySection />;
}
