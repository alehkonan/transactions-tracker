import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { getSession } from "~/api/auth.functions";
import { getCurrentProfile } from "~/api/profile.functions";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { SignOutButton } from "~/modules/auth/SignOutButton";
import { ExportTransactionsButton } from "~/modules/transactions/ExportTransactionsButton";

export const Route = createFileRoute("/settings")({
  loader: async () => {
    const [profile, user] = await Promise.all([getCurrentProfile(), getSession()]);
    return { profile, user };
  },
  component: () => {
    const { profile, user } = useLoaderData({ from: "/settings" });

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
