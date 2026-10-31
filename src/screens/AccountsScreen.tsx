import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageContainer } from "~/components/PageContainer";
import { Select } from "~/components/Select";
import { AccountCard } from "~/modules/accounts/AccountCard";
import { computeAccountActivity } from "~/modules/accounts/compute-account-activity";
import { computeBalanceTotals } from "~/modules/accounts/compute-balances";
import { CreateAccountButton } from "~/modules/accounts/CreateAccountButton";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { NamedSpheres } from "~/modules/spheres/NamedSpheres";
import { operatingBalances } from "~/modules/spheres/operating";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";

export function AccountsScreen() {
  const search = useSearch({ from: "/_client/accounts" });
  const navigate = useNavigate({ from: "/accounts" });
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
  const status = search.status ?? "ACTIVE";
  const view = search.view ?? "accounts";
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
          </div>
          <fieldset className="border-border flex w-full gap-1 rounded-2xl border p-1 sm:w-fit">
            <legend className="sr-only">View your money</legend>
            {[
              { value: "accounts", label: "Accounts", description: "Where your money is" },
              { value: "purposes", label: "Purposes", description: "What your money is for" },
            ].map((option) => (
              <label
                key={option.value}
                className="relative min-w-0 flex-1 cursor-pointer sm:min-w-36"
              >
                <input
                  type="radio"
                  name="accounts-view"
                  value={option.value}
                  checked={view === option.value}
                  onChange={() =>
                    void navigate({
                      search: (previous) => ({
                        ...previous,
                        view: option.value as "accounts" | "purposes",
                      }),
                      resetScroll: false,
                    })
                  }
                  aria-controls={`${option.value}-view`}
                  aria-label={`${option.label}: ${option.description}`}
                  className="peer sr-only"
                  data-testid={`view-${option.value}`}
                />
                <span className="text-text peer-checked:bg-accent peer-checked:text-surface peer-focus-visible:ring-accent flex min-h-11 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2">
                  {option.label}
                </span>
              </label>
            ))}
          </fieldset>
          <section id="accounts-view" aria-label="Accounts" hidden={view !== "accounts"}>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <h2 className="sr-only">Where your money is</h2>
              <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-xs">
                <label htmlFor="accounts-status" className="text-text text-sm font-bold">
                  Show
                </label>
                <Select
                  id="accounts-status"
                  data-testid="accounts-status"
                  value={status}
                  onValueChange={(value) =>
                    void navigate({
                      search: (previous) => ({
                        ...previous,
                        status: (value ?? "ACTIVE") as "ACTIVE" | "ARCHIVED" | "ALL",
                      }),
                      resetScroll: false,
                    })
                  }
                  options={[
                    { value: "ACTIVE", label: "Active accounts" },
                    { value: "ARCHIVED", label: "Archived accounts" },
                    { value: "ALL", label: "All accounts" },
                  ]}
                />
              </div>
              <CreateAccountButton />
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
                    listStatus={status}
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
          </section>
          <div id="purposes-view" hidden={view !== "purposes"}>
            <NamedSpheres key={selectedProfileId} complete={complete} operating={sphereBalances} />
          </div>
        </div>
      </main>
    </PageContainer>
  );
}
