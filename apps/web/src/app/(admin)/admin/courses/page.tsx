import type { Metadata } from "next";
import { CoursesPage } from "@/components/admin/courses/courses-page";

export const metadata: Metadata = { title: "Courses" };

export default function Page() {
  return <CoursesPage />;
}
