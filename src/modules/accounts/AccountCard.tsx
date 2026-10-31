import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { ChevronRightIcon } from "lucide-react";
import { twJoin } from "tailwind-merge";
import { formatMoney } from "~/utils/format-money";
import { AccountStatusChip } from "./AccountStatusChip";
import type { AccountActivity } from "~/modules/accounts/compute-account-activity";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

type Props = {
  account: AccountWithBalance;
  /** What this account has been doing lately; absent for one that has never been touched. */
  activity?: AccountActivity;
  listStatus: "ACTIVE" | "ARCHIVED" | "ALL";
};

/** Account summary linking to its stable detail page. */
export function AccountCard({ account, activity, listStatus }: Props) {
  const monthAmount = Number(activity?.monthToDateAmount ?? 0);
  const formattedBalance = formatMoney(account.balance, account.currencyCode);
  const details = [
    account.currencyCode,
    activity && `${formatDistanceToNowStrict(activity.lastActivityAt)} ago`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      to="/accounts/$accountId"
      params={{ accountId: account.id }}
      search={{ status: listStatus }}
      data-testid={`account-${account.id}`}
      aria-label={`${account.name}. ${account.status.toLowerCase()} account, balance ${formattedBalance}`}
      className="bg-surface hover:bg-surface-hover focus-visible:ring-accent flex min-h-28 w-full min-w-0 flex-col justify-between gap-3 rounded-lg p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-text truncate text-xs font-bold">{account.name}</span>
          <span className="text-text-muted text-xs">{details}</span>
        </div>
        {account.status === "ARCHIVED" ? (
          <AccountStatusChip status={account.status} />
        ) : (
          <ChevronRightIcon aria-hidden="true" className="text-text-muted size-4 shrink-0" />
        )}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-xl leading-none font-semibold break-all">
          {formattedBalance}
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
    </Link>
  );
}
