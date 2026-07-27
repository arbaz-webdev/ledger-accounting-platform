import type { UserRole } from "@/lib/auth";

/**
 * Pure data — safe to import from client components. (Keep it out of
 * `services/users.ts`, which is "server-only" and would poison the bundle.)
 */
export const ASSIGNABLE_ROLES: { value: UserRole; label: string; group: string }[] = [
  { value: "firm_owner", label: "Firm owner — subscription, team & clients", group: "Firm" },
  { value: "firm_admin", label: "Firm admin — full control of the books", group: "Accountant" },
  { value: "accountant_staff", label: "Accountant staff — books, no admin", group: "Accountant" },
  { value: "business_admin", label: "Business admin — client portal", group: "Business" },
  { value: "business_staff", label: "Business staff — client portal", group: "Business" },
  { value: "view_only", label: "View only — reports only", group: "Business" },
];

/** Human labels for every role, including ones nobody can self-assign. */
export const ROLE_LABEL: Record<UserRole, string> = {
  platform_admin: "Platform admin",
  firm_owner: "Firm owner",
  firm_admin: "Firm admin",
  accountant_staff: "Accountant staff",
  business_admin: "Business admin",
  business_staff: "Business staff",
  view_only: "View only",
};
