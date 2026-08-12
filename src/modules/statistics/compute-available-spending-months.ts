import { format, startOfMonth } from "date-fns";
import type { SyncedTransaction } from "~/modules/sync/sync-types";

export type SpendingMonth = {
  /** `yyyy-MM`, as it appears in the route's `month` search param. */
  value: string;
  label: string;
};

const monthLabel = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });

/**
 * Every month that has spending in it, newest first — the months the trend chart can page through.
 *
 * Months are local, not UTC: a purchase made late on the 31st belongs to the month the user made it
 * in. This was `date_trunc('month', created_at)` in the database's timezone, which is not
 * necessarily theirs.
 */
export function computeAvailableSpendingMonths(transactions: SyncedTransaction[]): SpendingMonth[] {
  const months = new Map<string, Date>();

  for (const transaction of transactions) {
    // TRANSFER rows move money between the user's own accounts and are not spending.
    if (transaction.type !== "EXPENSE") continue;

    const month = startOfMonth(transaction.createdAt);
    const value = format(month, "yyyy-MM");
    if (!months.has(value)) months.set(value, month);
  }

  return [...months]
    .toSorted(([a], [b]) => b.localeCompare(a))
    .map(([value, month]) => ({ value, label: monthLabel.format(month) }));
}
