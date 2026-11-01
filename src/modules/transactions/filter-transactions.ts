import { addDays, parse, startOfDay } from "date-fns";
import type { TransactionRow } from "./to-transaction-rows";

export type TransactionsFilter = {
  /** Inclusive lower bound, `yyyy-MM-dd`. */
  from?: string;
  /** Inclusive upper bound, `yyyy-MM-dd` — the whole day counts, not just its first instant. */
  to?: string;
  /** Legacy account-name search param. */
  account?: string;
  /** Stable account link; takes precedence over the legacy name filter. */
  accountId?: string;
  /** Category name, matching the `category` search param the filter select drives. */
  category?: string;
  /** Case-insensitive text matched against the row's account, category, comment, type, necessity, or currency. */
  search?: string;
};

const parseDateKey = (dateKey: string) => startOfDay(parse(dateKey, "yyyy-MM-dd", new Date()));

/**
 * The transactions table's own filters, applied in memory.
 *
 * Day boundaries are local, the way the user picked them in the date picker — a range ending
 * "yesterday" has to include everything that happened up to local midnight, not up to midnight in
 * whatever timezone the database happens to run in.
 */
export function filterTransactions(
  rows: TransactionRow[],
  { from, to, account, accountId, category, search }: TransactionsFilter,
): TransactionRow[] {
  const start = from ? parseDateKey(from) : undefined;
  // Exclusive upper bound at the next midnight, so the `to` day counts in full.
  const end = to ? addDays(parseDateKey(to), 1) : undefined;
  const query = search?.trim().toLocaleLowerCase();

  return rows.filter((row) => {
    if (start && row.createdAt < start) return false;
    if (end && row.createdAt >= end) return false;
    if (accountId != null && row.accountId !== accountId) return false;
    if (accountId == null && account != null && row.account !== account) return false;
    if (category != null && row.category !== category) return false;
    if (
      query &&
      ![
        row.account,
        row.category,
        row.comment,
        row.type,
        row.necessityLevel,
        row.currencyCode,
      ].some((value) => value?.toLocaleLowerCase().includes(query))
    ) {
      return false;
    }
    return true;
  });
}
