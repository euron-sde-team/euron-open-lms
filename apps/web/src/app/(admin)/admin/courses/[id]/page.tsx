import type { Metadata } from "next";
import { CourseEditor } from "@/components/admin/courses/course-editor";

export const metadata: Metadata = { title: "Course editor" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CourseEditor courseId={id} />;
}
