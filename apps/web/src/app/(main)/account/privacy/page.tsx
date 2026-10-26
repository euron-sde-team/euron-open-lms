import type { Metadata } from "next";
import { PrivacySection } from "@/components/account/privacy-section";

export const metadata: Metadata = { title: "Privacy and data" };

export default function Page() {
  return <PrivacySection />;
}
