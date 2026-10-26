import { Suspense } from "react";
import type { Metadata } from "next";
import { CatalogPage } from "@/components/catalog/catalog-page";

export const metadata: Metadata = { title: "Courses", description: "Browse every course: search, filter by topic, level, language and price." };

export default function CoursesPage() {
  return (
    <Suspense>
      <CatalogPage />
    </Suspense>
  );
}
