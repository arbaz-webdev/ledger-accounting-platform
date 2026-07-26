import { MODULE_LABEL, type ModuleKey } from "@/services/permissions";
import { EmptyState } from "@/components/ui";
import { IconShield } from "@/components/icons";

export default async function DeniedPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<{ module?: string }>;
}) {
  const { entityId } = await params;
  const { module } = await searchParams;
  const label = module ? (MODULE_LABEL[module as ModuleKey] ?? module) : "that area";

  return (
    <div className="fade-up card">
      <EmptyState
        icon={<IconShield className="h-5 w-5" />}
        title="You don't have access to this area"
        hint={`Your account isn't permitted to use ${label} for this client. A firm admin can grant it under Administration → Users.`}
        action={
          <a href={`/accountant/${entityId}`} className="btn btn-secondary btn-sm">
            Back to overview
          </a>
        }
      />
    </div>
  );
}
