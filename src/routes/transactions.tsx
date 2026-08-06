import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { format } from "date-fns";
import { PlusIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { z } from "zod";
import { getAccounts } from "~/api/account.functions";
import { getCategories } from "~/api/category.functions";
import { getTransactions, type TransactionRow } from "~/api/transaction.functions";
import { Button } from "~/components/Button";
import { DataTable, pageSizeOptions } from "~/components/DataTable";
import { Dialog } from "~/components/Dialog";
import { PageContainer } from "~/components/PageContainer";
import { Select } from "~/components/Select";
import { TransactionForm } from "~/modules/transaction-form/TransactionForm";
import { DaySummary } from "~/modules/transactions/DaySummary";
import { DeleteSelectedTransactionsButton } from "~/modules/transactions/DeleteSelectedTransactionsButton";
import { TransactionsDateRangeFilter } from "~/modules/transactions/TransactionsDateRangeFilter";
import { buildTransactionsTableColumns } from "~/modules/transactions/transactionsTableColumns";
import type { PaginationState } from "@tanstack/react-table";

const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const Route = createFileRoute("/transactions")({
  validateSearch: z.object({ from: dateKeySchema, to: dateKeySchema }),
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to }),
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
    const { from, to } = Route.useSearch();
    const [selectedRows, setSelectedRows] = useState<TransactionRow[]>([]);
    const [pagination, setPagination] = useState<PaginationState>({
      pageIndex: 0,
      pageSize: 10,
    });
    const pageSizeId = useId();
    const columns = useMemo(
      () => buildTransactionsTableColumns({ accounts, categories }),
      [accounts, categories],
    );
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
            <div className="flex flex-col gap-1">
              <label htmlFor={pageSizeId} className="text-text-muted text-xs">
                Page size
              </label>
              <Select
                id={pageSizeId}
                value={String(pagination.pageSize)}
                onValueChange={(v) =>
                  v && setPagination((prev) => ({ ...prev, pageIndex: 0, pageSize: +v }))
                }
                options={pageSizeOptions.map((pageSize) => String(pageSize))}
                className="h-auto p-1"
              />
            </div>
            <TransactionsDateRangeFilter from={from} to={to} />
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
          pagination={pagination}
          onPaginationChange={setPagination}
          groupBy={(row) => format(row.createdAt, "yyyy-MM-dd")}
          renderGroupSummary={(day) => (
            <DaySummary rows={transactionsByDay.get(day as string) ?? []} />
          )}
        />
      </PageContainer>
    );
  },
});
