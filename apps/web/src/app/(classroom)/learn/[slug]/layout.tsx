import type { Metadata } from "next";
import { ClassroomShell } from "@/components/classroom/classroom-shell";

export const metadata: Metadata = { title: "Classroom", robots: { index: false, follow: false } };

export default async function ClassroomLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ClassroomShell slug={decodeURIComponent(slug)}>{children}</ClassroomShell>;
}
