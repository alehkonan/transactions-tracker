import { addDays, parse, startOfDay } from "date-fns";
import type { TransactionRow } from "./to-transaction-rows";

export type TransactionsFilter = {
  /** Inclusive lower bound, `yyyy-MM-dd`. */
  from?: string;
  /** Inclusive upper bound, `yyyy-MM-dd` — the whole day counts, not just its first instant. */
  to?: string;
  /** Account name, matching the `account` search param the filter select drives. */
  account?: string;
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
  { from, to, account }: TransactionsFilter,
): TransactionRow[] {
  const start = from ? parseDateKey(from) : undefined;
  // Exclusive upper bound at the next midnight, so the `to` day counts in full.
  const end = to ? addDays(parseDateKey(to), 1) : undefined;

  return rows.filter((row) => {
    if (start && row.createdAt < start) return false;
    if (end && row.createdAt >= end) return false;
    if (account != null && row.account !== account) return false;
    return true;
  });
}
