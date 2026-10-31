import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "~/components/Button";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import type { SyncedSphere } from "~/modules/sync/sync-types";

export function SphereActivity({ sphere, complete }: { sphere: SyncedSphere; complete: boolean }) {
  const { allocations, transactions, accounts } = useSyncStore();
  const [visibleCount, setVisibleCount] = useState(50);
  const history = useMemo(() => {
    const transactionsById = new Map(
      transactions
        .filter((row) => row.profileId === sphere.profileId && row.deletedAt == null)
        .map((row) => [row.id, row]),
    );
    const accountsById = new Map(
      accounts
        .filter((row) => row.profileId === sphere.profileId && row.deletedAt == null)
        .map((row) => [row.id, row]),
    );
    return allocations
      .filter(
        (row) =>
          row.profileId === sphere.profileId &&
          row.sphereId === sphere.id &&
          row.deletedAt == null &&
          !row.reallocationId,
      )
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((allocation) => {
        const transaction = allocation.transactionId
          ? transactionsById.get(allocation.transactionId)
          : undefined;
        const accountId = allocation.openingAccountId ?? transaction?.accountId;
        return {
          allocation,
          transaction,
          account: accountId ? accountsById.get(accountId) : undefined,
        };
      });
  }, [allocations, transactions, accounts, sphere.id, sphere.profileId]);
  return (
    <section className="mt-6" aria-labelledby="sphere-activity-heading">
      <h2 id="sphere-activity-heading" className="mb-2 font-semibold">
        Account activity
      </h2>
      {!complete && (
        <p className="text-warning mb-2 text-sm">
          History is incomplete. Check synchronization to finish loading.
        </p>
      )}
      {history.length ? (
        <ul
          className="bg-surface divide-border divide-y overflow-hidden rounded-lg"
          data-testid="sphere-activity"
        >
          {history.slice(0, visibleCount).map(({ allocation: row, transaction, account }) => {
            const label = row.openingAccountId
              ? `Opening balance · ${account?.name ?? "Unavailable account"}`
              : transaction?.comment || "Transaction";
            const content = (
              <>
                <span className="min-w-0 wrap-anywhere">
                  <span className="block">{label}</span>
                  {transaction && (
                    <span className="text-text-muted mt-1 block text-xs">
                      {row.createdAt.toLocaleString()} · {account?.name ?? "Unavailable account"}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 font-mono tabular-nums ${Number(row.amount) < 0 ? "text-spend" : "text-text"}`}
                >
                  {formatMoney(row.amount, row.currencyCode)}
                </span>
              </>
            );
            return (
              <li key={row.id}>
                {transaction ? (
                  <Link
                    to="/transactions/$transactionId"
                    params={{ transactionId: transaction.id }}
                    className="hover:bg-surface-hover focus-visible:ring-accent flex min-h-11 flex-wrap items-center justify-between gap-3 p-4 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 p-4">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p
          className="bg-surface text-text-muted rounded-lg p-4 text-sm"
          data-testid="sphere-activity-empty"
        >
          {complete
            ? "No account activity assigned to this sphere yet."
            : "Loading account activity…"}
        </p>
      )}
      {history.length > visibleCount && (
        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => setVisibleCount((count) => count + 50)}
        >
          Show more activity ({history.length - visibleCount} remaining)
        </Button>
      )}
    </section>
  );
}
