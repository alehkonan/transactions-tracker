import { Link } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { ChevronRightIcon } from "lucide-react";
import { formatMoney } from "~/utils/format-money";
import { useMoneyNavigation } from "./money-navigation";
import type { AccountActivity } from "~/modules/accounts/compute-account-activity";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

type Props = {
  account: AccountWithBalance;
  /** What this account has been doing lately; absent for one that has never been touched. */
  activity?: AccountActivity;
  listStatus: "ACTIVE" | "ARCHIVED" | "ALL";
  complete: boolean;
};

/** Account summary linking to its stable detail page. */
export function AccountCard({ account, activity, listStatus, complete }: Props) {
  const { listState } = useMoneyNavigation();
  const formattedBalance = complete
    ? formatMoney(account.balance, account.currencyCode)
    : "Loading…";
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
      state={listState}
      data-testid={`account-${account.id}`}
      aria-label={`${account.name}. ${account.status.toLowerCase()} account, balance ${formattedBalance}`}
      className="text-text hover:bg-surface-hover focus-visible:ring-accent grid min-h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 px-4 py-3 text-left focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-28">
          <span className="block font-medium wrap-anywhere">{account.name}</span>
          <span className="text-text-muted block text-xs">{details}</span>
        </div>
        <span
          className={`ml-auto max-w-full text-right font-mono text-sm break-all tabular-nums ${complete && Number(account.balance) < 0 ? "text-warning" : "text-text"}`}
        >
          {formattedBalance}
          {complete && Number(account.balance) < 0 && (
            <span className="block font-sans text-xs">Below zero</span>
          )}
        </span>
      </div>
      <ChevronRightIcon aria-hidden="true" className="text-text-muted size-4 shrink-0" />
    </Link>
  );
}
