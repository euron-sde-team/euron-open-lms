import type { Metadata } from "next";
import { GradingQueue } from "@/components/admin/grading/grading-queue";

export const metadata: Metadata = { title: "Grading" };

export default function Page() {
  return <GradingQueue />;
}
