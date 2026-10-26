import { Suspense } from "react";
import type { Metadata } from "next";
import { ResetPassword } from "@/components/auth/reset-password";

export const metadata: Metadata = { title: "Choose a new password" };

export default function Page() {
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}
