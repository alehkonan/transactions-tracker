import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { PageContainer } from "~/components/PageContainer";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { useCategories } from "~/modules/categories/useCategories";
import { TransactionForm } from "~/modules/transaction-form/TransactionForm";
import { DeleteSelectedTransactionsButton } from "~/modules/transactions/DeleteSelectedTransactionsButton";
import { filterTransactions } from "~/modules/transactions/filter-transactions";
import { groupTransactionsByDay } from "~/modules/transactions/group-transactions-by-day";
import { TransactionsAccountFilter } from "~/modules/transactions/TransactionsAccountFilter";
import { TransactionsCategoryFilter } from "~/modules/transactions/TransactionsCategoryFilter";
import { TransactionsDateRangeFilter } from "~/modules/transactions/TransactionsDateRangeFilter";
import { TransactionsList } from "~/modules/transactions/TransactionsList";
import { useTransactionRows } from "~/modules/transactions/useTransactionRows";
import { useMediaQuery } from "~/utils/useMediaQuery";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

/** Tailwind's `sm`, where the table stops fitting and the list takes over. */
const TABLE_MEDIA_QUERY = "(min-width: 40rem)";

/**
 * A chunk of its own, fetched the first time a wide screen asks for it: the table brings TanStack
 * Table with it, and a phone renders the list instead and should not pay for a library it will
 * never run. Named export, so the module has to be unwrapped into the default `lazy` expects.
 */
const TransactionsTable = lazy(() =>
  import("~/modules/transactions/TransactionsTable").then((module) => ({
    default: module.TransactionsTable,
  })),
);

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

    const [selectedRows, setSelectedRows] = useState<TransactionRow[]>([]);
    const [editingTransaction, setEditingTransaction] = useState<TransactionRow | null>(null);
    const transactionsByDay = useMemo(() => groupTransactionsByDay(transactions), [transactions]);
    // Two presentations of the same rows, one mounted at a time: the columns the table needs don't
    // fit a phone, and rendering both to hide one with CSS would build the loser on every render.
    const showTable = useMediaQuery(TABLE_MEDIA_QUERY);

    return (
      <PageContainer>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <TransactionsDateRangeFilter from={from} to={to} />
            <TransactionsAccountFilter accounts={accounts} selected={accountFilter} />
            <TransactionsCategoryFilter categories={categories} selected={categoryFilter} />
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedRows.length > 0 && (
              <DeleteSelectedTransactionsButton ids={selectedRows.map((row) => row.id)} />
            )}
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
        <div className="py-4" />
        {showTable ? (
          // A bordered box the size the table will be, rather than a spinner: the chunk is small
          // and local, and a placeholder that matches what replaces it doesn't move the page.
          <Suspense
            fallback={<div className="border-border bg-surface h-[600px] rounded-xl border" />}
          >
            <TransactionsTable
              rows={transactions}
              rowsByDay={transactionsByDay}
              onSelectionChange={setSelectedRows}
              onRowClick={setEditingTransaction}
            />
          </Suspense>
        ) : (
          <TransactionsList
            rowsByDay={transactionsByDay}
            onSelectionChange={setSelectedRows}
            onRowClick={setEditingTransaction}
          />
        )}
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
