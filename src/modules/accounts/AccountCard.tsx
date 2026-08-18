import { formatDistanceToNowStrict } from "date-fns";
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
  /** Overrides the default "click opens the edit dialog" behavior — the collapsed peek stack uses this to expand the group on click instead. */
  onClick?: () => void;
};

/**
 * Small "plastic card" tile summarizing one account: name, status, balance, and what has moved
 * through it. Click opens the edit dialog.
 *
 * Deliberately short. At 8:5 the tile was ~230px of gradient on a desktop and ~450px on a phone to
 * carry four short facts, so three accounts filled a screen; the height it gave up is now paying
 * for two it didn't have.
 */
export function AccountCard({ account, activity, onClick }: Props) {
  const [isEditOpen, setEditOpen] = useState(false);
  const monthAmount = Number(activity?.monthToDateAmount ?? 0);
  const typeLabel = account.status === "ARCHIVED" ? account.type.toLowerCase() : undefined;

  return (
    <>
      <button
        type="button"
        onClick={onClick ?? (() => setEditOpen(true))}
        className={twMerge(
          // `bg-surface` under the gradient, not just at its start: the tint the gradient ends on
          // is translucent, and in a collapsed peek stack that means reading the card behind
          // through this one.
          "from-surface bg-surface flex min-h-28 w-full flex-col justify-between gap-3 rounded-2xl bg-linear-to-br p-3 text-left shadow-sm",
          account.status === "ARCHIVED"
            ? "to-archived-muted/20 dark:to-archived-muted/30"
            : account.type === "CURRENT"
              ? "to-accent-muted"
              : "to-saving-muted dark:to-saving-muted-dark/50",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="text-text truncate text-xs font-bold">{account.name}</span>
            <span className="text-text-muted text-xs">
              {typeLabel && <span className="capitalize">{typeLabel}</span>}
              {activity &&
                `${typeLabel ? " · " : ""}${formatDistanceToNowStrict(activity.lastActivityAt)} ago`}
            </span>
          </div>
          <AccountStatusChip status={account.status} />
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-xl leading-none font-semibold">
            {formatMoney(account.balance, account.currencyCode)}
          </span>
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
