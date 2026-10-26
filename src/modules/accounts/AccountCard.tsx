import { formatDistanceToNowStrict } from "date-fns";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { twJoin, twMerge } from "tailwind-merge";
import { Dialog } from "~/components/Dialog";
import { formatMoney } from "~/utils/format-money";
import { AccountForm } from "./AccountForm";
import { AccountStatusChip } from "./AccountStatusChip";
import type { AccountActivity } from "~/modules/accounts/compute-account-activity";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

type Props = {
  account: AccountWithBalance;
  /** What this account has been doing lately; absent for one that has never been touched. */
  activity?: AccountActivity;
};

/**
 * Small "plastic card" tile summarizing one account: name, status, balance, and what has moved
 * through it. Click opens the edit dialog.
 *
 * Deliberately short. At 8:5 the tile was ~230px of gradient on a desktop and ~450px on a phone to
 * carry four short facts, so three accounts filled a screen; the height it gave up is now paying
 * for two it didn't have.
 */
export function AccountCard({ account, activity }: Props) {
  const [isEditOpen, setEditOpen] = useState(false);
  const monthAmount = Number(activity?.monthToDateAmount ?? 0);
  const formattedBalance = formatMoney(account.balance, account.currencyCode);
  const details = [
    account.currencyCode,
    activity && `${formatDistanceToNowStrict(activity.lastActivityAt)} ago`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        data-testid={`account-${account.id}`}
        aria-label={`Edit ${account.name}. ${account.status.toLowerCase()} account, balance ${formattedBalance}`}
        className={twMerge(
          "group from-surface bg-surface focus-visible:ring-accent flex min-h-28 w-full cursor-pointer flex-col justify-between gap-3 rounded-2xl bg-linear-to-br p-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transform-none motion-reduce:transition-none",
          account.status === "ARCHIVED" ? "to-archived-muted" : "to-accent-muted",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="text-text truncate text-xs font-bold">{account.name}</span>
            <span className="text-text-muted text-xs">{details}</span>
          </div>
          {account.status === "ARCHIVED" ? (
            <AccountStatusChip status={account.status} />
          ) : (
            <PencilIcon
              aria-hidden="true"
              className="text-text-muted group-hover:text-accent size-4 shrink-0 transition-colors"
            />
          )}
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-xl leading-none font-semibold">{formattedBalance}</span>
          {monthAmount !== 0 && (
            <span
              className={twJoin(
                "shrink-0 font-mono text-xs whitespace-nowrap",
                monthAmount > 0 ? "text-gain" : "text-expense",
              )}
            >
              {monthAmount > 0 && "+"}
              {formatMoney(activity?.monthToDateAmount ?? null, account.currencyCode)} this month
            </span>
          )}
        </div>
      </button>
      <Dialog title="Edit account" open={isEditOpen} onOpenChange={setEditOpen}>
        <AccountForm account={account} />
      </Dialog>
    </>
  );
}
