import type { Metadata } from "next";
import { GradingDetailPage } from "@/components/admin/grading/grading-detail";

export const metadata: Metadata = { title: "Review submission" };

export default async function Page({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  return <GradingDetailPage submissionId={submissionId} />;
}
