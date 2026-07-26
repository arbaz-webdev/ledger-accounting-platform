import { guardEntity } from "@/lib/guard";

export default async function ModuleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  await guardEntity(entityId, "admin");
  return <>{children}</>;
}
