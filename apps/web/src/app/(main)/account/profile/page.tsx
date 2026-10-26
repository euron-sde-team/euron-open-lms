import type { Metadata } from "next";
import { ProfileSection } from "@/components/account/profile-section";

export const metadata: Metadata = { title: "Profile" };

export default function Page() {
  return <ProfileSection />;
}
