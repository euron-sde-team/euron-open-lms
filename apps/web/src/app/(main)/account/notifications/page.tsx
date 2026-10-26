import type { Metadata } from "next";
import { NotificationsSection } from "@/components/account/notifications-section";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return <NotificationsSection />;
}
