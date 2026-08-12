import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { getAccounts, getBalanceTotals } from "~/api/account.functions";
import { PageContainer } from "~/components/PageContainer";
import { accountTypeStyles } from "~/modules/accounts/account-type-tag";
import { AccountGroupSection } from "~/modules/accounts/AccountGroupSection";
import { accountStatusStyles } from "~/modules/accounts/AccountStatusChip";
import { CreateAccountButton } from "~/modules/accounts/CreateAccountButton";
import { ReconcileBalancesButton } from "~/modules/accounts/ReconcileBalancesButton";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];
type BalanceTotals = Awaited<ReturnType<typeof getBalanceTotals>>;

function getAccountGroups(accounts: Account[], totals: BalanceTotals) {
  return [
    {
      id: "current",
      title: "Current",
      accounts: accounts.filter(
        (account) => account.status === "ACTIVE" && account.type === "CURRENT",
      ),
      totalUsd: totals.currentBalanceUsd,
      totalChipClassName: accountTypeStyles.CURRENT,
      defaultCollapsed: false,
    },
    {
      id: "savings",
      title: "Savings",
      accounts: accounts.filter(
        (account) => account.status === "ACTIVE" && account.type === "SAVING",
      ),
      totalUsd: totals.savingsBalanceUsd,
      totalChipClassName: accountTypeStyles.SAVING,
      defaultCollapsed: false,
    },
    {
      id: "archived",
      title: "Archive",
      accounts: accounts.filter((account) => account.status === "ARCHIVED"),
      totalUsd: totals.archivedBalanceUsd,
      totalChipClassName: accountStatusStyles.ARCHIVED,
      defaultCollapsed: true,
    },
  ];
}

export const Route = createFileRoute("/accounts")({
  loader: async () => {
    const [accounts, totals] = await Promise.all([getAccounts(), getBalanceTotals()]);
    return { accounts, totals };
  },
  component: () => {
    const { accounts, totals } = useLoaderData({ from: "/accounts" });
    const groups = getAccountGroups(accounts, totals);

    return (
      <PageContainer>
        <div className="flex items-center justify-end gap-2">
          <ReconcileBalancesButton />
          <CreateAccountButton />
        </div>
        <div className="py-4" />
        {accounts.length === 0 ? (
          <p>No accounts yet.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => {
              if (!group.accounts.length) return null;
              return <AccountGroupSection key={group.title} {...group} />;
            })}
          </div>
        )}
      </PageContainer>
    );
  },
});
