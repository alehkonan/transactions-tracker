import { useNavigate } from "@tanstack/react-router";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { NamedSpheres } from "~/modules/spheres/NamedSpheres";
import { usePurposeBalances } from "~/modules/spheres/usePurposeBalances";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export function ArchivedPurposesScreen() {
  const navigate = useNavigate();
  const profileId = useSelectedProfileId();
  const replicaId = useSyncStore((state) => state.replicaContext?.replicaId);
  const { complete, operating } = usePurposeBalances();
  return (
    <PageContainer>
      <main className="mx-auto w-full max-w-2xl py-2 md:py-6">
        <PageHeader
          title="Archived purposes"
          backLabel="Purposes"
          onBack={() => void navigate({ to: "/accounts", search: { view: "purposes" } })}
        />
        <p className="text-text-muted mb-4 text-sm">
          Archived spheres keep their history. Open a sphere to restore it.
        </p>
        <NamedSpheres
          key={`${replicaId}:${profileId}`}
          complete={complete}
          operating={operating}
          archivedView
        />
      </main>
    </PageContainer>
  );
}
