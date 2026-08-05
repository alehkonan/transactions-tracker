import { formatMoney } from "~/utils/formatMoney";
import type { TransactionRow } from "~/api/transaction.functions";

type Props = {
  rows: TransactionRow[];
};

function sumApproxUsd(rows: TransactionRow[]): string {
  const total = rows.reduce((sum, row) => sum + Math.abs(Number(row.approxAmountUsd ?? 0)), 0);
  return total.toFixed(2);
}

/** Per-day total spent/earned across all currencies, converted to USD. */
export function DaySummary({ rows }: Props) {
  const totalSpentUsd = sumApproxUsd(rows.filter((row) => row.type === "EXPENSE"));
  const totalIncomeUsd = sumApproxUsd(rows.filter((row) => row.type === "INCOME"));

  return (
    <div className="flex items-center justify-end gap-4 text-xs">
      <span className="text-expense">Spent: {formatMoney(totalSpentUsd, "USD")}</span>
      <span className="text-income">Income: {formatMoney(totalIncomeUsd, "USD")}</span>
    </div>
  );
}
