import type { Metadata } from "next";
import { AdminLearners } from "@/components/admin/ops/learners";

export const metadata: Metadata = { title: "Learners" };

export default function Page() {
  return <AdminLearners />;
}
