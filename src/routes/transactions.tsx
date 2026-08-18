import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { PageContainer } from "~/components/PageContainer";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { useCategories } from "~/modules/categories/useCategories";
import { TransactionForm } from "~/modules/transaction-form/TransactionForm";
import { filterTransactions } from "~/modules/transactions/filter-transactions";
import { groupTransactionsByDay } from "~/modules/transactions/group-transactions-by-day";
import { TransactionsAccountFilter } from "~/modules/transactions/TransactionsAccountFilter";
import { TransactionsCategoryFilter } from "~/modules/transactions/TransactionsCategoryFilter";
import { TransactionsDateRangeFilter } from "~/modules/transactions/TransactionsDateRangeFilter";
import { TransactionsList } from "~/modules/transactions/TransactionsList";
import { useTransactionRows } from "~/modules/transactions/useTransactionRows";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const Route = createFileRoute("/transactions")({
  validateSearch: z.object({
    from: dateKeySchema,
    to: dateKeySchema,
    account: z.string().optional(),
    category: z.string().optional(),
  }),
  component: () => {
    const { from, to, account: accountFilter, category: categoryFilter } = Route.useSearch();
    const accounts = useAccounts();
    const categories = useCategories();
    const allTransactions = useTransactionRows();
    // The filters are the same ones the server used to run, over rows already in memory — so
    // picking a date range costs a re-render rather than a query.
    const transactions = useMemo(
      () =>
        filterTransactions(allTransactions, {
          from,
          to,
          account: accountFilter,
          category: categoryFilter,
        }),
      [allTransactions, from, to, accountFilter, categoryFilter],
    );

    const [editingTransaction, setEditingTransaction] = useState<TransactionRow | null>(null);
    const transactionsByDay = useMemo(() => groupTransactionsByDay(transactions), [transactions]);

    return (
      <PageContainer>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <TransactionsDateRangeFilter from={from} to={to} />
            <TransactionsAccountFilter accounts={accounts} selected={accountFilter} />
            <TransactionsCategoryFilter categories={categories} selected={categoryFilter} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Dialog
              title="Add transaction"
              renderTrigger={({ onOpen }) => (
                <Button variant="primary" aria-label="Add transaction" onClick={onOpen}>
                  <PlusIcon />
                  <span className="hidden sm:block">Add</span>
                </Button>
              )}
            >
              <TransactionForm accounts={accounts} categories={categories} />
            </Dialog>
          </div>
        </div>
        <div className="py-1 sm:py-4" />
        <TransactionsList rowsByDay={transactionsByDay} onRowClick={setEditingTransaction} />
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
