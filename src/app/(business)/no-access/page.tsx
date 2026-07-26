import { EmptyState } from "@/components/ui";
import { IconShield } from "@/components/icons";

export default function NoAccessPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="card">
        <EmptyState
          icon={<IconShield className="h-5 w-5" />}
          title="No business linked to your account yet"
          hint="Your accountant needs to grant your account access to a client business before this portal has anything to show."
        />
      </div>
    </main>
  );
}
