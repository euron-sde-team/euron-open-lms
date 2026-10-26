import { Suspense } from "react";
import type { Metadata } from "next";
import { ForgotPassword } from "@/components/auth/forgot-password";

export const metadata: Metadata = { title: "Reset password" };

export default function Page() {
  return (
    <Suspense>
      <ForgotPassword />
    </Suspense>
  );
}
