import type { Metadata } from "next";
import { VerifyForm } from "@/components/verify/verify";

export const metadata: Metadata = { title: "Check a certificate", description: "Confirm that a certificate is genuine from its serial." };

export default function Page() {
  return <VerifyForm />;
}
