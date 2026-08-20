import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { selectProfile } from "~/api/profile.functions";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { computeProfileSummaries } from "~/modules/accounts/compute-balances";
import { CreateProfileButton } from "~/modules/profile/CreateProfileButton";
import { ProfileCard } from "~/modules/profile/ProfileCard";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export const Route = createFileRoute("/profile")({
  component: () => {
    const navigate = useNavigate();
    // Not profile-scoped, unlike every other page: the pull covers all of the user's profiles, which
    // is what lets this list each one's totals without a query per tile.
    const profiles = useSyncStore((state) => state.profiles);
    const accounts = useSyncStore((state) => state.accounts);
    const transactions = useSyncStore((state) => state.transactions);
    const usdRates = useSyncStore((state) => state.usdRates);

    const summaries = useMemo(
      () => computeProfileSummaries(profiles, accounts, transactions, usdRates),
      [profiles, accounts, transactions, usdRates],
    );

    const handleSelect = async (id: string) => {
      // The cookies the guard reads are set by the server, so the navigation waits for them —
      // leaving early would bounce straight back here with nothing selected.
      await selectProfile({ data: { profileId: id } });
      await navigate({ to: "/" });
    };

    return (
      <PageContainer>
        <div className="flex items-center justify-between">
          <Title variant="page">Choose a profile</Title>
          <CreateProfileButton />
        </div>
        <hr className="border-border my-3" />
        {summaries.length === 0 ? (
          <p>No profiles yet — create one to get started.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
            {summaries.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                onOpen={() => handleSelect(profile.id)}
              />
            ))}
          </div>
        )}
      </PageContainer>
    );
  },
});
