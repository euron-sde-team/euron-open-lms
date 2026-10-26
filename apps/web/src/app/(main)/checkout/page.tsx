import type { Metadata } from "next";
import { CheckoutPage } from "@/components/checkout/checkout-page";
import { RequireAuth } from "@/components/common/require-auth";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <RequireAuth>
      <CheckoutPage />
    </RequireAuth>
  );
}
