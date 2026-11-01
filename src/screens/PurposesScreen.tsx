import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { useMoneyNavigation } from "~/modules/accounts/money-navigation";
import { NamedSpheres } from "~/modules/spheres/NamedSpheres";
import { usePurposeBalances } from "~/modules/spheres/usePurposeBalances";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export function PurposesScreen() {
  const { selectedProfileId, replicaContext } = useSyncStore();
  const { complete, operating } = usePurposeBalances();
  const { back } = useMoneyNavigation();
  return (
    <PageContainer>
      <main className="mx-auto max-w-2xl py-2 md:py-6">
        <PageHeader title="Purposes" backLabel="Money" onBack={back} />
        <NamedSpheres
          key={`${replicaContext?.replicaId}:${selectedProfileId}`}
          complete={complete}
          operating={operating}
        />
      </main>
    </PageContainer>
  );
}
