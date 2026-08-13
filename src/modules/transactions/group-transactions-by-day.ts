import { format } from "date-fns";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

/**
 * Splits rows into `yyyy-MM-dd` days, keeping the order they arrive in — which is newest-first,
 * since `toTransactionRows` sorts and nothing downstream re-sorts.
 *
 * The map is the whole grouping for both presentations: the table looks a day up by its group key
 * to render that day's header, and the list iterates the entries in order.
 */
export function groupTransactionsByDay(rows: TransactionRow[]): Map<string, TransactionRow[]> {
  const byDay = new Map<string, TransactionRow[]>();

  for (const row of rows) {
    const day = format(row.createdAt, "yyyy-MM-dd");
    const dayRows = byDay.get(day);
    if (dayRows) dayRows.push(row);
    else byDay.set(day, [row]);
  }

  return byDay;
}
