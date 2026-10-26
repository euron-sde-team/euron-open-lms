import type { Metadata } from "next";
import { ModerationPage } from "@/components/admin/moderation/moderation-page";

export const metadata: Metadata = { title: "Moderation" };

export default function Page() {
  return <ModerationPage />;
}
