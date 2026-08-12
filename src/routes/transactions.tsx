import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { format } from "date-fns";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { getAccounts } from "~/api/account.functions";
import { getCategories } from "~/api/category.functions";
import { getTransactions, type TransactionRow } from "~/api/transaction.functions";
import { Button } from "~/components/Button";
import { DataTable } from "~/components/DataTable";
import { Dialog } from "~/components/Dialog";
import { PageContainer } from "~/components/PageContainer";
import { TransactionForm } from "~/modules/transaction-form/TransactionForm";
import { DaySummary } from "~/modules/transactions/DaySummary";
import { DeleteSelectedTransactionsButton } from "~/modules/transactions/DeleteSelectedTransactionsButton";
import { buildTransactionsTableColumns } from "~/modules/transactions/transactions-table-columns";
import { TransactionsAccountFilter } from "~/modules/transactions/TransactionsAccountFilter";
import { TransactionsDateRangeFilter } from "~/modules/transactions/TransactionsDateRangeFilter";

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const Route = createFileRoute("/transactions")({
  validateSearch: z.object({
    from: dateKeySchema,
    to: dateKeySchema,
    account: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to, account: search.account }),
  loader: async ({ deps }) => {
    const [transactions, accounts, categories] = await Promise.all([
      getTransactions({ data: deps }),
      getAccounts(),
      getCategories(),
    ]);
    return { transactions, accounts, categories };
  },
  component: () => {
    const { transactions, accounts, categories } = useLoaderData({
      from: "/transactions",
    });
    const { from, to, account: accountFilter } = Route.useSearch();
    const [selectedRows, setSelectedRows] = useState<TransactionRow[]>([]);
    const [editingTransaction, setEditingTransaction] = useState<TransactionRow | null>(null);
    const columns = useMemo(() => buildTransactionsTableColumns(), []);
    const transactionsByDay = useMemo(() => {
      const byDay = new Map<string, TransactionRow[]>();
      for (const row of transactions) {
        const day = format(row.createdAt, "yyyy-MM-dd");
        const dayRows = byDay.get(day);
        if (dayRows) dayRows.push(row);
        else byDay.set(day, [row]);
      }
      return byDay;
    }, [transactions]);

    return (
      <PageContainer>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <TransactionsDateRangeFilter from={from} to={to} />
            <TransactionsAccountFilter accounts={accounts} selected={accountFilter} />
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedRows.length > 0 && (
              <DeleteSelectedTransactionsButton ids={selectedRows.map((row) => row.id)} />
            )}
            <Dialog
              title="Add transaction"
              renderTrigger={({ onOpen }) => (
                <Button variant="primary" onClick={onOpen}>
                  <PlusIcon />
                  <span className="hidden sm:block">Add</span>
                </Button>
              )}
            >
              <TransactionForm accounts={accounts} categories={categories} />
            </Dialog>
          </div>
        </div>
        <div className="py-4" />
        <DataTable
          columns={columns}
          data={transactions}
          enableRowSelection
          onSelectionChange={setSelectedRows}
          onRowClick={setEditingTransaction}
          groupBy={(row) => format(row.createdAt, "yyyy-MM-dd")}
          renderGroupSummary={(day) => (
            <DaySummary rows={transactionsByDay.get(day as string) ?? []} />
          )}
        />
        <Dialog
          title="Update transaction"
          open={editingTransaction !== null}
          onOpenChange={(open) => !open && setEditingTransaction(null)}
        >
          {editingTransaction && (
            <TransactionForm
              accounts={accounts}
              categories={categories}
              transaction={editingTransaction}
            />
          )}
        </Dialog>
      </PageContainer>
    );
  },
});
