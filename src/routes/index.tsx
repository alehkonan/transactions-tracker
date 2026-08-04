import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { getAccounts } from "~/api/account.functions";
import { Card } from "~/components/Card";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { ReconcileBalancesButton } from "~/modules/accounts/ReconcileBalancesButton";

export const Route = createFileRoute("/")({
  loader: async () => {
    const accounts = await getAccounts();

    return {
      accounts,
    };
  },
  component: () => {
    const { accounts } = useLoaderData({ from: "/" });

    return (
      <PageContainer>
        <div className="grid gap-2 md:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between">
              <Title variant="card">Active accounts</Title>
              <ReconcileBalancesButton />
            </div>
            {accounts.length === 0 ? (
              <p>No accounts yet.</p>
            ) : (
              <ul>
                {accounts.map((account) => (
                  <li key={account.id}>
                    {account.name} — {account.balance} {account.currencyCode} ({account.status})
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <Title variant="card">Key Stats</Title>
          </Card>
          <Card>
            <Title variant="card">Recent transactions</Title>
          </Card>
        </div>
      </PageContainer>
    );
  },
});
