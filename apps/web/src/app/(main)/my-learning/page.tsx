import type { Metadata } from "next";
import { RequireAuth } from "@/components/common/require-auth";
import { MyLearningPage } from "@/components/my-learning/my-learning-page";

export const metadata: Metadata = { title: "My learning", robots: { index: false, follow: false } };

export default function MyLearningRoute() {
  return (
    <RequireAuth>
      <MyLearningPage />
    </RequireAuth>
  );
}
