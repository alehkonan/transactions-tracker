import { format, isToday, isYesterday, parseISO } from "date-fns";
import { formatMoney } from "~/utils/format-money";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Props = {
  /** The group key the transactions list groups by: a `yyyy-MM-dd` day. */
  day: string;
  rows: TransactionRow[];
};

function sumApproxUsd(rows: TransactionRow[]): string {
  const total = rows.reduce((sum, row) => sum + Math.abs(Number(row.approxAmountUsd ?? 0)), 0);
  return total.toFixed(2);
}

/** "Today" and "Yesterday" for the two days anyone is actually entering money on, dates below that. */
function formatDay(day: string): string {
  const date = parseISO(day);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEE d MMM");
}

/**
 * The day a group of transactions belongs to, with what was spent and earned on it across all
 * currencies, converted to USD. Rendered above its group, so the total arrives with the day it
 * describes rather than after it.
 */
export function DayHeader({ day, rows }: Props) {
  const totalSpentUsd = sumApproxUsd(rows.filter((row) => row.type === "EXPENSE"));
  const totalIncomeUsd = sumApproxUsd(rows.filter((row) => row.type === "INCOME"));
  const hasIncome = Number(totalIncomeUsd) > 0;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
      <h3 className="text-text font-semibold">{formatDay(day)}</h3>
      <span className="flex gap-4">
        <span className="text-expense">Spent: {formatMoney(totalSpentUsd, "USD")}</span>
        {hasIncome && (
          <span className="text-gain">Income: {formatMoney(totalIncomeUsd, "USD")}</span>
        )}
      </span>
    </div>
  );
}
