import { Link, createFileRoute } from "@tanstack/react-router";
import { Card } from "~/components/Card";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { formatMoney } from "~/utils/format-money";

export const Route = createFileRoute("/")({
  component: () => {
    const accounts = useAccounts();
    const activeCurrentAccounts = accounts.filter(
      (account) => account.status === "ACTIVE" && account.type === "CURRENT",
    );

    return (
      <PageContainer>
        <div className="grid gap-2 md:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between">
              <Title variant="card">Active accounts</Title>
              <Link to="/accounts" className="text-accent text-sm font-medium hover:underline">
                Manage accounts
              </Link>
            </div>
            <hr className="border-border my-3" />
            {activeCurrentAccounts.length === 0 ? (
              <p>No active accounts.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {activeCurrentAccounts.map((account) => (
                  <li key={account.id} className="flex items-center justify-between gap-2 py-1">
                    {account.name}
                    <span className="font-mono font-medium">
                      {formatMoney(account.balance, account.currencyCode)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageContainer>
    );
  },
});
