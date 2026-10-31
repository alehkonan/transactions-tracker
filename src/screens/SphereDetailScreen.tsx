import { useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/Button";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { NamedSpheres } from "~/modules/spheres/NamedSpheres";
import { usePurposeBalances } from "~/modules/spheres/usePurposeBalances";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export function SphereDetailScreen({ sphereId }: { sphereId: string }) {
  const profileId = useSelectedProfileId();
  const replicaId = useSyncStore((state) => state.replicaContext?.replicaId);
  return <SphereDetail key={`${replicaId}:${profileId}:${sphereId}`} sphereId={sphereId} />;
}

function SphereDetail({ sphereId }: { sphereId: string }) {
  const navigate = useNavigate();
  const profileId = useSelectedProfileId();
  const { spheres, isHydrated, pending, status } = useSyncStore();
  const { complete, operating } = usePurposeBalances();
  const sphere = spheres.find(
    (row) => row.id === sphereId && row.profileId === profileId && row.deletedAt == null,
  );
  const loading = !isHydrated || pending.includes("spheres");
  const interrupted = status === "error" || status === "unauthorized";
  const returnToPurposes = () => void navigate({ to: "/accounts", search: { view: "purposes" } });
  const back = () =>
    sphere?.archived ? void navigate({ to: "/accounts/purposes/archived" }) : returnToPurposes();
  return (
    <PageContainer className="pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <main className="mx-auto w-full max-w-2xl py-2 md:py-6" aria-label="Sphere details">
        <PageHeader
          title={sphere?.name ?? "Purpose"}
          backLabel={sphere?.archived ? "Archived purposes" : "Purposes"}
          onBack={back}
        />
        {sphere ? (
          <>
            <p className="text-text-muted mb-4 text-sm">
              {sphere.type === "OPERATING"
                ? "Operating"
                : sphere.type === "FUNDS"
                  ? "Funds"
                  : "Capital"}{" "}
              · {sphere.archived ? "Archived" : "Active"}. This is money already included in your
              account balances.
            </p>
            <NamedSpheres complete={complete} operating={operating} selectedSphere={sphere} />
          </>
        ) : (
          <section
            className="bg-surface rounded-lg p-4"
            aria-live="polite"
            data-testid="sphere-unavailable"
          >
            <h2 className="font-semibold">
              {loading
                ? interrupted
                  ? "Purpose not loaded yet"
                  : "Loading purpose…"
                : "Purpose unavailable"}
            </h2>
            <p className="text-text-muted mt-2 text-sm">
              {loading
                ? "This purpose has not reached this device yet. Return to Purposes or check synchronization to continue."
                : "It may have been deleted, belong to another profile, or no longer be accessible in this profile."}
            </p>
            <Button className="mt-4" variant="secondary" onClick={returnToPurposes}>
              Return to Purposes
            </Button>
          </section>
        )}
      </main>
    </PageContainer>
  );
}
