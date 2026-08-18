import { addMonths, getDate, getDaysInMonth, parse, startOfMonth } from "date-fns";
import { toUsd } from "~/utils/money";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { SyncedTransaction } from "~/modules/sync/sync-types";

export type SpendingTrendPoint = {
  day: number;
  cumulativeUsd: number;
};

type Options = {
  transactions: SyncedTransaction[];
  accounts: AccountWithBalance[];
  usdRates: Record<string, number>;
  /** The month to plot, as `yyyy-MM`. */
  month: string;
};

/**
 * Spending through a month, accumulated day by day, in USD.
 *
 * The month's bounds are local — same reasoning as `computeAvailableSpendingMonths`. EXPENSE rows are
 * stored negative and the chart rises from zero, so amounts are plotted as magnitudes.
 */
export function computeMonthlySpendingTrend({
  transactions,
  accounts,
  usdRates,
  month,
}: Options): SpendingTrendPoint[] {
  const monthStart = startOfMonth(parse(month, "yyyy-MM", new Date()));
  const monthEnd = addMonths(monthStart, 1);
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currencyCode]));

  const dailyUsd = Array.from({ length: getDaysInMonth(monthStart) }, () => 0);
  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE") continue;
    if (transaction.createdAt < monthStart || transaction.createdAt >= monthEnd) continue;

    const currencyCode =
      transaction.accountId != null ? currencyByAccount.get(transaction.accountId) : undefined;
    // No account means no currency to convert from, so the row cannot be placed on a USD axis.
    if (currencyCode == null) continue;

    dailyUsd[getDate(transaction.createdAt) - 1] += Math.abs(
      toUsd(transaction.amount, currencyCode, usdRates),
    );
  }

  let cumulative = 0;
  return dailyUsd.map((amount, index) => {
    cumulative += amount;
    return { day: index + 1, cumulativeUsd: Math.round(cumulative * 100) / 100 };
  });
}
