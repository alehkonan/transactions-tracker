import { createFileRoute, Link } from "@tanstack/react-router";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { readSessionHint } from "~/modules/auth/session-hint";
import { SignOutButton } from "~/modules/auth/SignOutButton";
import { CategoryTag } from "~/modules/categories/CategoryTag";
import { CreateCategoryButton } from "~/modules/categories/CreateCategoryButton";
import { useCategories } from "~/modules/categories/useCategories";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { IntegrityCheck } from "~/modules/sync/IntegrityCheck";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { ExportTransactionsButton } from "~/modules/transactions/ExportTransactionsButton";

export const Route = createFileRoute("/settings")({
  component: () => {
    const categories = useCategories();
    const colors = useSyncStore((state) => state.colors);
    const profiles = useSyncStore((state) => state.profiles);
    const profileId = readSelectedProfileId();
    const profile = profiles.find((candidate) => candidate.id === profileId);
    // From the hint cookie rather than a `getSession()` call: the name is only being displayed, and
    // this page has no business being the one thing in the app that needs the network.
    const username = readSessionHint()?.username;

    return (
      <PageContainer>
        <Title variant="section">User</Title>
        <div className="flex items-center justify-between gap-3">
          <span className="text-text">{username ?? "Signed in"}</span>
          <SignOutButton />
        </div>
        <hr className="border-border my-3" />
        <Title variant="section">Profile</Title>
        <div className="flex items-center justify-between">
          <span className="text-text">{profile?.name ?? "None"}</span>
          <Link to="/profile" className="text-accent text-sm hover:underline">
            Change
          </Link>
        </div>
        <hr className="border-border my-3" />
        <div className="flex items-center justify-between gap-2">
          <Title variant="section">Categories</Title>
          <CreateCategoryButton colors={colors} />
        </div>
        {categories.length === 0 ? (
          <p className="text-text-muted text-sm">No categories yet.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {categories.map((category) => (
              <CategoryTag key={category.id} category={category} colors={colors} />
            ))}
          </div>
        )}
        <hr className="border-border my-3" />
        <Title variant="section">Import / Export</Title>
        <div className="flex flex-col items-start gap-1">
          <Link to="/transactions-import" className="text-accent text-sm hover:underline">
            Import transactions
          </Link>
          <ExportTransactionsButton />
        </div>
        <hr className="border-border my-3" />
        <Title variant="section">Local data</Title>
        <IntegrityCheck />
      </PageContainer>
    );
  },
});
