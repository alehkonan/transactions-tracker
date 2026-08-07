import { format } from "date-fns";
import { ApproxUsdTag } from "~/modules/transactions/ApproxUsdTag";
import { CategoryTag } from "~/modules/transactions/CategoryTag";
import { NecessityLevelTag } from "~/modules/transactions/NecessityLevelTag";
import { TransactionTypeTag } from "~/modules/transactions/TransactionTypeTag";
import { formatMoney } from "~/utils/formatMoney";
import type { ColumnDef } from "@tanstack/react-table";
import type { TransactionRow } from "~/api/transaction.functions";

export function buildTransactionsTableColumns(): ColumnDef<TransactionRow>[] {
  return [
    {
      accessorKey: "createdAt",
      header: "Datetime",
      size: 175,
      cell: ({ getValue }) => format(getValue<Date>(), "yyyy-MM-dd HH:mm"),
    },
    {
      accessorKey: "category",
      header: "Category",
      size: 140,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <CategoryTag name={row.original.category} colorHex={row.original.categoryColorHex} />
        </div>
      ),
    },
    {
      accessorKey: "necessityLevel",
      header: "Necessity",
      size: 120,
      cell: ({ getValue }) => {
        const level = getValue<TransactionRow["necessityLevel"]>();
        return level ? (
          <div className="flex justify-center">
            <NecessityLevelTag level={level} />
          </div>
        ) : null;
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      size: 100,
      cell: ({ getValue }) => (
        <div className="flex justify-center">
          <TransactionTypeTag type={getValue<TransactionRow["type"]>()} />
        </div>
      ),
    },
    {
      accessorKey: "account",
      header: "Account",
      size: 140,
    },
    {
      id: "amount",
      header: "Amount",
      size: 160,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1.5">
          {row.original.currencyCode !== "USD" && row.original.approxAmountUsd != null && (
            <ApproxUsdTag amountUsd={row.original.approxAmountUsd} />
          )}
          <span>{formatMoney(row.original.amount, row.original.currencyCode)}</span>
        </div>
      ),
    },
  ];
}
