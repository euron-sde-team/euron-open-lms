import type { Metadata } from "next";
import type { BundleDetail } from "@open-lms/types";
import { BundlePage } from "@/components/catalog/bundles";
import { serverGet } from "@/lib/server-api";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const b = await serverGet<BundleDetail>(`/catalog/bundles/${encodeURIComponent(slug)}`);
  if (!b) return { title: "Bundle", robots: { index: false } };
  const description = b.description.slice(0, 160);
  return { title: b.title, description, openGraph: { title: b.title, description, images: b.coverUrl ? [{ url: b.coverUrl }] : undefined } };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  return <BundlePage slug={slug} />;
}
