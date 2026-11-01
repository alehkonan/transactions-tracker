import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useMemo } from "react";
import { PageContainer } from "~/components/PageContainer";
import { AccountCard } from "~/modules/accounts/AccountCard";
import { computeAccountActivity } from "~/modules/accounts/compute-account-activity";
import { computeBalanceTotals } from "~/modules/accounts/compute-balances";
import { CreateAccountButton } from "~/modules/accounts/CreateAccountButton";
import { useMoneyNavigation } from "~/modules/accounts/money-navigation";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { NamedSpheres } from "~/modules/spheres/NamedSpheres";
import { usePurposeBalances } from "~/modules/spheres/usePurposeBalances";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";

export function AccountsScreen() {
  const accounts = useAccounts();
  const { usdRates, transactions, selectedProfileId, replicaContext, status } = useSyncStore();
  const { complete, operating } = usePurposeBalances();
  const { listState } = useMoneyNavigation();
  const total = useMemo(() => computeBalanceTotals(accounts, usdRates), [accounts, usdRates]);
  const active = accounts.filter((account) => account.status === "ACTIVE");
  const archivedCount = accounts.length - active.length;
  const activityByAccount = useMemo(() => computeAccountActivity(transactions), [transactions]);
  const interrupted = status === "error" || status === "unauthorized";

  return (
    <PageContainer>
      <main aria-labelledby="money-heading" className="mx-auto max-w-2xl space-y-8 py-2 md:py-6">
        <header>
          <h1 id="money-heading" className="text-text mb-4 text-2xl font-bold">
            Money
          </h1>
          <section aria-labelledby="balance-heading" className="bg-surface rounded-lg p-4">
            <h2 id="balance-heading" className="text-text font-medium">
              Total balance
            </h2>
            <p
              className="text-text mt-2 font-mono text-3xl font-semibold break-all"
              data-testid="accounts-total"
            >
              {complete ? `≈ ${formatMoney(total.balanceUsd, "USD")}` : "Loading…"}
            </p>
            <p className="text-text-muted mt-2 text-sm">
              Approximate USD value · Includes archived accounts
            </p>
          </section>
          {!complete && (
            <output className="text-warning mt-3 block text-sm" data-testid="money-incomplete">
              {interrupted
                ? "Balances are incomplete. Check synchronization in Settings to finish loading."
                : "Loading balances. Totals will appear when account and purpose data are complete."}
            </output>
          )}
        </header>
        <NamedSpheres
          key={`${replicaContext?.replicaId}:${selectedProfileId}`}
          complete={complete}
          operating={operating}
          overview
        />
        <section aria-labelledby="accounts-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="accounts-heading" className="text-text text-lg font-semibold">
              Accounts
            </h2>
            <CreateAccountButton />
          </div>
          {active.length > 0 ? (
            <ul
              className="bg-surface divide-border divide-y overflow-hidden rounded-lg"
              data-testid="accounts-list"
            >
              {active.map((account) => (
                <li key={account.id}>
                  <AccountCard
                    account={account}
                    activity={activityByAccount.get(account.id)}
                    listStatus="ACTIVE"
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
              {!complete
                ? "Loading accounts…"
                : accounts.length === 0
                  ? "Create an account to start tracking your money."
                  : "No active accounts. Add an account or restore an archived one."}
            </p>
          )}
          <Link
            to="/accounts/archived"
            state={listState}
            className="bg-surface text-text hover:bg-surface-hover focus-visible:ring-accent mt-3 flex min-h-11 items-center justify-between gap-3 rounded-lg px-4 py-3 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
            data-testid="archived-accounts"
          >
            <span>Archived accounts{complete ? ` (${archivedCount})` : ""}</span>
            <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0" />
          </Link>
        </section>
      </main>
    </PageContainer>
  );
}
