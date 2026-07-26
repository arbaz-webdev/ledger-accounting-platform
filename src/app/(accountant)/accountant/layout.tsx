import { requireAccountant } from "@/lib/auth";

/** Auth guard only — chrome is rendered per level (client list vs entity shell). */
export default async function AccountantLayout({ children }: { children: React.ReactNode }) {
  await requireAccountant();
  return <>{children}</>;
}
