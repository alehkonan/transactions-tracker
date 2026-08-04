import { DeleteTransactionButton } from "~/modules/transactions/DeleteTransactionButton";
import { NecessityLevelTag } from "~/modules/transactions/NecessityLevelTag";
import { formatDateTime } from "~/utils/formatDate";
import { formatMoney } from "~/utils/formatMoney";
import type { ColumnDef } from "@tanstack/react-table";
import type { TransactionRow } from "~/api/transaction.functions";

export const transactionsTableColumns: ColumnDef<TransactionRow>[] = [
  {
    accessorKey: "createdAt",
    header: "Datetime",
    size: 175,
    cell: ({ getValue }) => formatDateTime(getValue<Date>()),
  },
  {
    accessorKey: "category",
    header: "Category",
    size: 140,
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
  },
  {
    accessorKey: "account",
    header: "Account",
    size: 140,
  },
  {
    id: "amount",
    header: "Amount",
    size: 100,
    cell: ({ row }) => formatMoney(row.original.amount, row.original.currencyCode),
  },
  {
    id: "actions",
    header: "",
    size: 60,
    cell: ({ row }) => <DeleteTransactionButton id={row.original.id} />,
  },
];
