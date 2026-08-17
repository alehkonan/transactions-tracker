import { format } from "date-fns";
import { CategoryTag } from "~/modules/categories/CategoryTag";
import { ApproxUsdTag } from "~/modules/transactions/ApproxUsdTag";
import { NecessityLevelTag } from "~/modules/transactions/NecessityLevelTag";
import { transactionTypeIcons } from "~/modules/transactions/transaction-type-tag";
import { formatMoney } from "~/utils/format-money";
import type { ColumnDef } from "@tanstack/react-table";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

export function buildTransactionsTableColumns(): ColumnDef<TransactionRow>[] {
  return [
    {
      accessorKey: "createdAt",
      header: "Time",
      size: 70,
      cell: ({ getValue }) => format(getValue<Date>(), "HH:mm"),
    },
    {
      accessorKey: "account",
      header: "Account",
      size: 220,
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
      size: 110,
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
      accessorKey: "comment",
      header: "Comment",
      size: 440,
      cell: ({ getValue }) => {
        const comment = getValue<string | null>();
        return comment ? <span className="text-text-muted block truncate">{comment}</span> : null;
      },
    },
    {
      id: "amount",
      header: "Amount",
      size: 230,
      cell: ({ row }) => {
        const TransferIcon = transactionTypeIcons.TRANSFER;
        return (
          <div className="flex flex-wrap items-center justify-end gap-x-1.5">
            {row.original.type === "TRANSFER" && (
              <TransferIcon className="text-transfer size-3.5 shrink-0" />
            )}
            {row.original.currencyCode !== "USD" && row.original.approxAmountUsd != null && (
              <ApproxUsdTag amountUsd={row.original.approxAmountUsd} />
            )}
            <span>{formatMoney(row.original.amount, row.original.currencyCode)}</span>
          </div>
        );
      },
    },
  ];
}
