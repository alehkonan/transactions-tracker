import { DeleteTransactionButton } from "~/modules/transactions/DeleteTransactionButton";
import { EditTransactionButton } from "~/modules/transactions/EditTransactionButton";
import { NecessityLevelTag } from "~/modules/transactions/NecessityLevelTag";
import { TransactionTypeTag } from "~/modules/transactions/TransactionTypeTag";
import { formatDateTime } from "~/utils/formatDate";
import { formatMoney } from "~/utils/formatMoney";
import type { ColumnDef } from "@tanstack/react-table";
import type { getAccounts } from "~/api/account.functions";
import type { getCategories } from "~/api/category.functions";
import type { TransactionRow } from "~/api/transaction.functions";

type Options = {
  accounts: Awaited<ReturnType<typeof getAccounts>>;
  categories: Awaited<ReturnType<typeof getCategories>>;
};

export function buildTransactionsTableColumns({
  accounts,
  categories,
}: Options): ColumnDef<TransactionRow>[] {
  return [
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
      size: 100,
      cell: ({ row }) => formatMoney(row.original.amount, row.original.currencyCode),
    },
    {
      id: "actions",
      header: "",
      size: 100,
      cell: ({ row }) => (
        <div className="flex justify-center gap-1">
          <EditTransactionButton
            transaction={row.original}
            accounts={accounts}
            categories={categories}
          />
          <DeleteTransactionButton id={row.original.id} />
        </div>
      ),
    },
  ];
}
