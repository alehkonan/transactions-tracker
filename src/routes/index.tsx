import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { Card } from "~/components/Card";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { getAccounts } from "~/utils/account.functions";

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
            <Title variant="card">Active accounts</Title>
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
