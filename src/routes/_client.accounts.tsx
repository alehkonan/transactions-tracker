import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageContainer } from "~/components/PageContainer";
import { Select } from "~/components/Select";
import { AccountCard } from "~/modules/accounts/AccountCard";
import { computeAccountActivity } from "~/modules/accounts/compute-account-activity";
import { computeBalanceTotals } from "~/modules/accounts/compute-balances";
import { CreateAccountButton } from "~/modules/accounts/CreateAccountButton";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { operatingBalances } from "~/modules/spheres/operating";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";

export const Route = createFileRoute("/_client/accounts")({
  component: () => {
    const accounts = useAccounts();
    const {
      usdRates,
      transactions,
      accounts: rawAccounts,
      allocations,
      selectedProfileId,
      isHydrated,
      pending,
    } = useSyncStore();
    const complete =
      isHydrated &&
      !pending.some((table) =>
        ["accounts", "transactions", "spheres", "allocations"].includes(table),
      );
    const sphereBalances = useMemo(
      () =>
        operatingBalances(
          selectedProfileId ?? "",
          { accounts: rawAccounts, transactions, allocations },
          complete,
        ),
      [selectedProfileId, rawAccounts, transactions, allocations, complete],
    );
    const [status, setStatus] = useState("ACTIVE");
    const total = useMemo(() => computeBalanceTotals(accounts, usdRates), [accounts, usdRates]);
    const visibleAccounts = accounts.filter(
      (account) => status === "ALL" || account.status === status,
    );
    // Keyed by account id, so the rows of other profiles in the store simply never get looked up.
    const activityByAccount = useMemo(() => computeAccountActivity(transactions), [transactions]);

    return (
      <PageContainer>
        <main aria-labelledby="accounts-heading" className="py-2 md:py-6">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 id="accounts-heading" className="text-text text-xl font-semibold">
                  Accounts
                </h1>
                <p className="text-text-muted text-sm" data-testid="accounts-total">
                  Approx. total balance:{" "}
                  <span className="font-mono">≈ {formatMoney(total.balanceUsd, "USD")}</span>
                </p>
                <p className="text-text-muted text-xs">Includes archived accounts</p>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="accounts-status" className="text-text text-sm font-bold">
                  Show
                </label>
                <Select
                  id="accounts-status"
                  data-testid="accounts-status"
                  value={status}
                  onValueChange={(value) => setStatus(value ?? "ACTIVE")}
                  options={[
                    { value: "ACTIVE", label: "Active accounts" },
                    { value: "ARCHIVED", label: "Archived accounts" },
                    { value: "ALL", label: "All accounts" },
                  ]}
                />
              </div>
            </div>
            <section
              aria-labelledby="operating-heading"
              className="border-border border-y py-4"
              data-testid="operating-sphere"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="operating-heading" className="text-text font-semibold">
                  Operating
                </h2>
                <span className="text-text-muted text-xs">
                  System sphere · includes archived accounts
                </span>
              </div>
              <p className="text-text-muted mt-1 text-sm">
                Money assigned to everyday income and spending.
              </p>
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2" data-testid="operating-balances">
                {sphereBalances.map((balance) => (
                  <div key={balance.currencyCode}>
                    <dt className="text-text-muted text-xs">{balance.currencyCode}</dt>
                    <dd className="text-text font-mono tabular-nums">
                      {formatMoney(balance.sphereBalance, balance.currencyCode)}
                    </dd>
                  </div>
                ))}
              </dl>
              <output
                className="text-text-muted mt-2 block text-xs"
                data-testid="operating-reconciliation"
              >
                {!complete
                  ? "Incomplete balances — synchronize to finish loading."
                  : sphereBalances.some((balance) => balance.status === "diverged")
                    ? "Balances differ — check synchronization in Settings."
                    : sphereBalances.length === 0
                      ? "Create an account to start allocating money."
                      : "Matches account balances in every currency."}
              </output>
              {sphereBalances.some((balance) => Number(balance.sphereBalance) < 0) && (
                <p className="text-warning mt-2 text-xs">Operating has a negative balance.</p>
              )}
            </section>
            {visibleAccounts.length > 0 ? (
              <div
                className="grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-2"
                data-testid="accounts-list"
              >
                {visibleAccounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    activity={activityByAccount.get(account.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-text-muted py-4" data-testid="accounts-empty">
                {accounts.length === 0
                  ? "Create an account to start tracking your money."
                  : status === "ARCHIVED"
                    ? "No archived accounts."
                    : "No active accounts."}
              </p>
            )}
            <div className="w-full sm:max-w-sm">
              <CreateAccountButton />
            </div>
          </div>
        </main>
      </PageContainer>
    );
  },
});
