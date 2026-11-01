import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { SecuritySection } from "~/modules/auth/SecuritySection";

export function SecurityScreen() {
  return (
    <PageContainer>
      <main className="mx-auto">
        <PageHeader title="Sign-in methods" backTo="/settings" backLabel="Settings" />
        <div className="bg-surface rounded-lg">
          <SecuritySection />
        </div>
      </main>
    </PageContainer>
  );
}
