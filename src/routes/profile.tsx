import { createFileRoute, useLoaderData, useNavigate } from "@tanstack/react-router";
import { getProfiles, selectProfile } from "~/api/profile.functions";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { CreateProfileButton } from "~/modules/profile/CreateProfileButton";
import { ProfileCard } from "~/modules/profile/ProfileCard";

export const Route = createFileRoute("/profile")({
  loader: async () => {
    const profiles = await getProfiles();
    return { profiles };
  },
  component: () => {
    const { profiles } = useLoaderData({ from: "/profile" });
    const navigate = useNavigate();

    const handleSelect = async (id: number) => {
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
        {profiles.length === 0 ? (
          <p>No profiles yet — create one to get started.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                onSelect={() => handleSelect(profile.id)}
              />
            ))}
          </div>
        )}
      </PageContainer>
    );
  },
});
