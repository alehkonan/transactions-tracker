import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageContainer } from "~/components/PageContainer";
import { Select } from "~/components/Select";
import { AccountCard } from "~/modules/accounts/AccountCard";
import { computeAccountActivity } from "~/modules/accounts/compute-account-activity";
import { computeBalanceTotals } from "~/modules/accounts/compute-balances";
import { CreateAccountButton } from "~/modules/accounts/CreateAccountButton";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";

export const Route = createFileRoute("/_client/accounts")({
  component: () => {
    const accounts = useAccounts();
    const usdRates = useSyncStore((state) => state.usdRates);
    const transactions = useSyncStore((state) => state.transactions);
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
