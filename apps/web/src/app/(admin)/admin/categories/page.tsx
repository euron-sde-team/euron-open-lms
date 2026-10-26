import type { Metadata } from "next";
import { CategoriesPage } from "@/components/admin/categories/categories-page";

export const metadata: Metadata = { title: "Categories" };

export default function Page() {
  return <CategoriesPage />;
}
