import { useMemo } from "react";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { AccountCard } from "~/modules/accounts/AccountCard";
import { computeAccountActivity } from "~/modules/accounts/compute-account-activity";
import { useMoneyNavigation } from "~/modules/accounts/money-navigation";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { usePurposeBalances } from "~/modules/spheres/usePurposeBalances";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export function ArchivedAccountsScreen() {
  const accounts = useAccounts().filter((account) => account.status === "ARCHIVED");
  const transactions = useSyncStore((state) => state.transactions);
  const activityByAccount = useMemo(() => computeAccountActivity(transactions), [transactions]);
  const { complete } = usePurposeBalances();
  const { back } = useMoneyNavigation();
  return (
    <PageContainer>
      <main className="mx-auto py-2 md:py-6">
        <PageHeader title="Archived accounts" backLabel="Money" onBack={back} />
        <p className="text-text-muted mb-4 text-sm">
          Archived accounts remain in your total balance. Open an account to restore it.
        </p>
        {accounts.length > 0 ? (
          <ul
            className="bg-surface divide-border divide-y overflow-hidden rounded-lg"
            data-testid="accounts-list"
          >
            {accounts.map((account) => (
              <li key={account.id}>
                <AccountCard
                  account={account}
                  activity={activityByAccount.get(account.id)}
                  listStatus="ARCHIVED"
                  complete={complete}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p
            className="bg-surface text-text-muted rounded-lg p-4 text-sm"
            data-testid="accounts-empty"
          >
            {complete ? "No archived accounts." : "Loading archived accounts…"}
          </p>
        )}
      </main>
    </PageContainer>
  );
}
