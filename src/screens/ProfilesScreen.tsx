import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { computeProfileSummaries } from "~/modules/accounts/compute-balances";
import { CreateProfileButton } from "~/modules/profile/CreateProfileButton";
import { selectProfileLocally } from "~/modules/profile/local-selection";
import { ProfileListItem } from "~/modules/profile/ProfileListItem";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export function ProfilesScreen() {
  const navigate = useNavigate();
  // The local replica includes every profile, so summaries need no per-profile requests.
  const profiles = useSyncStore((state) => state.profiles);
  const accounts = useSyncStore((state) => state.accounts);
  const transactions = useSyncStore((state) => state.transactions);
  const usdRates = useSyncStore((state) => state.usdRates);
  const selectedProfileId = useSyncStore((state) => state.selectedProfileId);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const summaries = useMemo(
    () => computeProfileSummaries(profiles, accounts, transactions, usdRates),
    [profiles, accounts, transactions, usdRates],
  );

  const handleSelect = async (id: string) => {
    setSelectionError(null);
    setIsSelecting(true);
    try {
      await selectProfileLocally(id);
      await navigate({ to: selectedProfileId ? "/settings" : "/" });
    } catch (cause) {
      setSelectionError(
        cause instanceof Error ? cause.message : "Could not select this profile. Try again.",
      );
    } finally {
      setIsSelecting(false);
    }
  };

  return (
    <PageContainer className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <main className="mx-auto max-w-3xl">
        {selectedProfileId ? (
          <PageHeader title="Choose a profile" backTo="/settings" backLabel="Settings" />
        ) : (
          <header className="mb-5">
            <h1 className="text-2xl font-bold tracking-tight">Choose a profile</h1>
            <p className="text-text-muted mt-2 text-sm">
              A profile keeps its own accounts, categories, and transactions.
            </p>
          </header>
        )}
        <div className="mb-4 flex justify-end">
          <CreateProfileButton />
        </div>
        {selectionError && (
          <p role="alert" className="text-danger mb-4 text-sm wrap-anywhere">
            {selectionError}
          </p>
        )}
        {summaries.length === 0 ? (
          <div className="bg-surface rounded-lg p-4">
            <h2 className="font-semibold">No profiles yet</h2>
            <p className="text-text-muted mt-1 text-sm">Create a profile to get started.</p>
          </div>
        ) : (
          <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg">
            {summaries.map((profile) => (
              <li key={profile.id}>
                <ProfileListItem
                  profile={profile}
                  isSelected={profile.id === selectedProfileId}
                  disabled={isSelecting}
                  onOpen={() => void handleSelect(profile.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </PageContainer>
  );
}
