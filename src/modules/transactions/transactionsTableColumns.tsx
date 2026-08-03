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
    id: "income",
    header: "From",
    columns: [
      {
        accessorKey: "incomeAccount",
        header: "Account",
        size: 140,
      },
      {
        id: "incomeAmount",
        header: "Amount",
        size: 100,
        cell: ({ row }) => formatMoney(row.original.incomeAmount, row.original.incomeCurrency),
      },
    ],
  },
  {
    id: "to",
    header: "To",
    columns: [
      {
        accessorKey: "outcomeAccount",
        header: "Account",
        size: 140,
      },
      {
        id: "outcomeAmount",
        header: "Amount",
        size: 100,
        cell: ({ row }) => formatMoney(row.original.outcomeAmount, row.original.outcomeCurrency),
      },
    ],
  },
  {
    id: "actions",
    header: "",
    size: 60,
    cell: ({ row }) => <DeleteTransactionButton id={row.original.id} />,
  },
];
