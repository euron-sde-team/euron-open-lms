import type { Metadata } from "next";
import type { CourseCard, Instructor } from "@open-lms/types";
import { InstructorPage } from "@/components/instructor/instructor-page";
import { serverGet } from "@/lib/server-api";

type Props = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const r = await serverGet<{ instructor: Instructor; courses: CourseCard[] }>(`/catalog/instructors/${encodeURIComponent(username)}`);
  if (!r) return { title: "Instructor", robots: { index: false } };
  const i = r.instructor;
  const description = (i.headline ?? i.bio ?? `Courses by ${i.displayName}`).slice(0, 160);
  return { title: i.displayName, description, openGraph: { type: "profile", title: i.displayName, description, images: i.avatarUrl ? [{ url: i.avatarUrl }] : undefined } };
}

export default async function Page({ params }: Props) {
  const { username } = await params;
  return <InstructorPage username={username} />;
}
