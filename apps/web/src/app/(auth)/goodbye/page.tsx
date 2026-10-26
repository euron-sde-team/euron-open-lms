import type { Metadata } from "next";
import { Goodbye } from "@/components/auth/goodbye";

export const metadata: Metadata = { title: "Account deleted" };

export default function Page() {
  return <Goodbye />;
}
