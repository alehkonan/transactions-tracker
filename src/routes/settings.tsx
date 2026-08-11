import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { getSession } from "~/api/auth.functions";
import { getCategories } from "~/api/category.functions";
import { getColors } from "~/api/color.functions";
import { getCurrentProfile } from "~/api/profile.functions";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { SignOutButton } from "~/modules/auth/SignOutButton";
import { CategoryTag } from "~/modules/categories/CategoryTag";
import { CreateCategoryButton } from "~/modules/categories/CreateCategoryButton";
import { ExportTransactionsButton } from "~/modules/transactions/ExportTransactionsButton";

export const Route = createFileRoute("/settings")({
  loader: async () => {
    const [profile, user, categories, colors] = await Promise.all([
      getCurrentProfile(),
      getSession(),
      getCategories(),
      getColors(),
    ]);
    return { profile, user, categories, colors };
  },
  component: () => {
    const { profile, user, categories, colors } = useLoaderData({ from: "/settings" });

    return (
      <PageContainer>
        <Title variant="section">User</Title>
        <div className="flex items-center justify-between gap-3">
          <span className="text-text">{user?.username ?? "Not signed in"}</span>
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
      </PageContainer>
    );
  },
});
