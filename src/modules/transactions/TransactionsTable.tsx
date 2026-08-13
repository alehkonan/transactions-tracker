import { format } from "date-fns";
import { useMemo } from "react";
import { DataTable } from "~/components/DataTable";
import { DayHeader } from "~/modules/transactions/DayHeader";
import { buildTransactionsTableColumns } from "~/modules/transactions/transactions-table-columns";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Props = {
  rows: TransactionRow[];
  /** The same rows grouped by day, for the header of each group — see `groupTransactionsByDay`. */
  rowsByDay: Map<string, TransactionRow[]>;
  onSelectionChange?: (selectedRows: TransactionRow[]) => void;
  onRowClick?: (row: TransactionRow) => void;
};

/**
 * The desktop presentation of the transactions, mirroring `TransactionsList`'s props so the route
 * can swap one for the other.
 *
 * It exists as its own module rather than as markup in the route so that it can be a chunk of its
 * own: `DataTable` pulls in TanStack Table, and below `sm` this component never renders, so a phone
 * has no reason to download it. The route loads it lazily — see `TransactionsTable` there.
 */
export function TransactionsTable({ rows, rowsByDay, onSelectionChange, onRowClick }: Props) {
  const columns = useMemo(() => buildTransactionsTableColumns(), []);

  return (
    <DataTable
      columns={columns}
      data={rows}
      enableRowSelection
      onSelectionChange={onSelectionChange}
      onRowClick={onRowClick}
      groupBy={(row) => format(row.createdAt, "yyyy-MM-dd")}
      renderGroupHeader={(day) => (
        <DayHeader day={day as string} rows={rowsByDay.get(day as string) ?? []} />
      )}
    />
  );
}
