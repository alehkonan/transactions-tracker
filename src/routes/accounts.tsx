import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageContainer } from "~/components/PageContainer";
import { accountTypeStyles } from "~/modules/accounts/account-type-tag";
import { AccountGroupSection } from "~/modules/accounts/AccountGroupSection";
import { accountStatusStyles } from "~/modules/accounts/AccountStatusChip";
import { computeAccountActivity } from "~/modules/accounts/compute-account-activity";
import { computeBalanceTotals } from "~/modules/accounts/compute-balances";
import { CreateAccountButton } from "~/modules/accounts/CreateAccountButton";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { AccountWithBalance, BalanceTotals } from "~/modules/accounts/compute-balances";

function getAccountGroups(accounts: AccountWithBalance[], totals: BalanceTotals) {
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
  component: () => {
    const accounts = useAccounts();
    const usdRates = useSyncStore((state) => state.usdRates);
    const transactions = useSyncStore((state) => state.transactions);
    const groups = useMemo(
      () => getAccountGroups(accounts, computeBalanceTotals(accounts, usdRates)),
      [accounts, usdRates],
    );
    // Keyed by account id, so the rows of other profiles in the store simply never get looked up.
    const activityByAccount = useMemo(() => computeAccountActivity(transactions), [transactions]);

    return (
      <PageContainer>
        <div className="flex flex-col gap-6">
          {groups.map((group) => {
            if (!group.accounts.length) return null;
            return (
              <AccountGroupSection
                key={group.title}
                {...group}
                activityByAccount={activityByAccount}
              />
            );
          })}
          <CreateAccountButton />
        </div>
      </PageContainer>
    );
  },
});
