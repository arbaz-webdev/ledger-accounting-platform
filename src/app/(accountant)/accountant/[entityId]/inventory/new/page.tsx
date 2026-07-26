import { PageHeader } from "@/components/ui";
import { NewItemForm } from "../item-form";

export default async function NewItemPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;

  return (
    <div className="fade-up">
      <PageHeader
        title="New inventory item"
        sub="The costing method is fixed once the item is created — it defines what existing cost layers mean."
      />
      <NewItemForm entityId={entityId} />
    </div>
  );
}
