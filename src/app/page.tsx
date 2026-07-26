import { redirect } from "next/navigation";
import { getCurrentUser, ACCOUNTANT_ROLES } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(ACCOUNTANT_ROLES.includes(user.role) ? "/accountant" : "/business");
}
