import { Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { ChevronRightIcon, PencilIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { AccountForm } from "~/modules/accounts/AccountForm";
import { computeAccountActivity } from "~/modules/accounts/compute-account-activity";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";

type Props = {
  accountId: string;
  listStatus?: "ACTIVE" | "ARCHIVED" | "ALL";
};

export function AccountDetailScreen(props: Props) {
  const profileId = useSelectedProfileId();
  const replicaId = useSyncStore((state) => state.replicaContext?.replicaId);
  return <AccountDetail key={`${replicaId}:${profileId}:${props.accountId}`} {...props} />;
}

function AccountDetail({ accountId, listStatus }: Props) {
  const navigate = useNavigate();
  const profileId = useSelectedProfileId();
  const accounts = useAccounts();
  const account = accounts.find((row) => row.id === accountId);
  const transactions = useSyncStore((state) => state.transactions);
  const pending = useSyncStore((state) => state.pending);
  const isHydrated = useSyncStore((state) => state.isHydrated);
  const syncStatus = useSyncStore((state) => state.status);
  const [isEditOpen, setEditOpen] = useState(false);
  const accountTransactions = useMemo(
    () => transactions.filter((row) => row.profileId === profileId && row.accountId === accountId),
    [transactions, profileId, accountId],
  );
  const activity = useMemo(
    () => computeAccountActivity(accountTransactions).get(accountId),
    [accountTransactions, accountId],
  );
  const loadingAccount = !isHydrated || pending.includes("accounts");
  const loadingActivity = loadingAccount || pending.includes("transactions");
  const interrupted = syncStatus === "error" || syncStatus === "unauthorized";
  const returnToAccounts = () =>
    void navigate({
      to: "/accounts",
      search: { status: listStatus ?? account?.status ?? "ACTIVE" },
    });

  return (
    <PageContainer className="pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <main aria-label="Account details" className="mx-auto w-full max-w-2xl py-2 md:py-6">
        <PageHeader
          title={account?.name ?? "Account"}
          backLabel="Accounts"
          onBack={returnToAccounts}
        />
        {!account ? (
          <section
            className="bg-surface rounded-lg p-4"
            aria-live="polite"
            data-testid="account-unavailable"
          >
            <h2 className="font-semibold">
              {loadingAccount
                ? interrupted
                  ? "Account not loaded yet"
                  : "Loading account…"
                : "Account unavailable"}
            </h2>
            <p className="text-text-muted mt-2 text-sm">
              {loadingAccount
                ? "This account has not reached this device yet. Return to Accounts or check synchronization to continue."
                : "It may have been deleted, belong to another profile, or no longer be accessible in this profile."}
            </p>
            <Button variant="secondary" className="mt-4" onClick={returnToAccounts}>
              Return to Accounts
            </Button>
          </section>
        ) : (
          <div className="flex flex-col gap-6" data-testid="account-detail">
            <section
              aria-label="Account properties"
              className="bg-surface overflow-hidden rounded-lg"
            >
              <dl className="divide-border divide-y">
                <div className="flex flex-wrap items-baseline justify-between gap-2 p-4">
                  <dt>Balance</dt>
                  <dd
                    className="min-w-0 text-right font-mono text-2xl font-semibold break-all"
                    data-testid="account-detail-balance"
                  >
                    {loadingActivity
                      ? "Loading…"
                      : formatMoney(account.balance, account.currencyCode)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt>Currency</dt>
                  <dd className="font-mono">{account.currencyCode}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <dt>Status</dt>
                  <dd className="font-semibold" data-testid="account-detail-status">
                    {account.status === "ARCHIVED" ? "Archived" : "Active"}
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                  <dt>Initial balance</dt>
                  <dd className="min-w-0 text-right font-mono break-all">
                    {formatMoney(account.initialBalance, account.currencyCode)}
                  </dd>
                </div>
              </dl>
            </section>
            <p className="text-text-muted -mt-4 px-1 text-sm">
              {account.status === "ARCHIVED"
                ? "Archived accounts keep their balance and history. Reactivate this account in Edit account to record new transactions."
                : "Balance includes the initial balance and all transactions. Archive this account in Edit account to keep its balance and history."}
            </p>
            <section aria-labelledby="account-activity-heading">
              <h2 id="account-activity-heading" className="mb-2 px-1 font-semibold">
                Activity
              </h2>
              <div className="bg-surface overflow-hidden rounded-lg">
                {loadingActivity ? (
                  <output
                    className="text-text-muted block p-4 text-sm"
                    data-testid="account-activity-loading"
                  >
                    {interrupted
                      ? "Activity is incomplete. Check synchronization to finish loading."
                      : "Loading activity…"}
                  </output>
                ) : activity ? (
                  <dl className="divide-border divide-y" data-testid="account-activity">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                      <dt>Net change this month</dt>
                      <dd className="min-w-0 text-right font-mono break-all">
                        {formatMoney(activity.monthToDateAmount, account.currencyCode)}
                      </dd>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                      <dt>Last transaction</dt>
                      <dd>{format(activity.lastActivityAt, "PP")}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-4 py-3">
                      <dt>Transactions</dt>
                      <dd className="font-mono">{accountTransactions.length.toLocaleString()}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-text-muted p-4 text-sm" data-testid="account-activity-empty">
                    No transactions yet. This account’s balance comes from its initial balance.
                  </p>
                )}
                <Link
                  to="/transactions"
                  search={{ accountId }}
                  data-testid="account-transactions"
                  className="border-border text-accent hover:bg-surface-hover focus-visible:ring-accent flex min-h-11 items-center justify-between gap-3 border-t px-4 py-3 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                >
                  View transactions
                  <ChevronRightIcon aria-hidden="true" className="size-5 shrink-0" />
                </Link>
              </div>
            </section>
            <Dialog
              title="Edit account"
              open={isEditOpen}
              onOpenChange={(open) => {
                setEditOpen(open);
                if (
                  !open &&
                  !useSyncStore
                    .getState()
                    .accounts.some((row) => row.id === accountId && row.profileId === profileId)
                )
                  returnToAccounts();
              }}
              renderTrigger={({ onOpen }) => (
                <Button
                  variant="secondary"
                  onClick={onOpen}
                  data-testid="account-edit"
                  disabled={loadingActivity}
                >
                  <PencilIcon aria-hidden="true" className="size-4" />
                  Edit account
                </Button>
              )}
            >
              <AccountForm account={account} />
            </Dialog>
          </div>
        )}
      </main>
    </PageContainer>
  );
}
