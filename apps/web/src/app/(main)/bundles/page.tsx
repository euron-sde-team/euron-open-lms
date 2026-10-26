import type { Metadata } from "next";
import { BundlesPage } from "@/components/catalog/bundles";

export const metadata: Metadata = { title: "Bundles", description: "Several courses together, for less than buying them one by one." };

export default function Page() {
  return <BundlesPage />;
}
