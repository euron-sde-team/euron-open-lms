import { ItemView } from "@/components/classroom/item-view";

export default async function LearnItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return <ItemView itemId={decodeURIComponent(itemId)} />;
}
