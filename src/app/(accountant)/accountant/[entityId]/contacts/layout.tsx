import { guardEntityAny } from "@/lib/guard";

export default async function ContactsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  await guardEntityAny(entityId, ["sales", "purchases"]);
  return <>{children}</>;
}
