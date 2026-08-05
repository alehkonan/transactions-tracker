import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { PlusIcon, UploadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { getAccounts } from "~/api/account.functions";
import { getCategories } from "~/api/category.functions";
import { getTransactions, type TransactionRow } from "~/api/transaction.functions";
import { Button } from "~/components/Button";
import { DataTable } from "~/components/DataTable";
import { Dialog } from "~/components/Dialog";
import { NavLink } from "~/components/NavLink";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { TransactionForm } from "~/modules/transaction-form/TransactionForm";
import { DaySummary } from "~/modules/transactions/DaySummary";
import { DeleteSelectedTransactionsButton } from "~/modules/transactions/DeleteSelectedTransactionsButton";
import { buildTransactionsTableColumns } from "~/modules/transactions/transactionsTableColumns";
import { getDayKey } from "~/utils/formatDate";

export const Route = createFileRoute("/transactions")({
  loader: async () => {
    const [transactions, accounts, categories] = await Promise.all([
      getTransactions(),
      getAccounts(),
      getCategories(),
    ]);
    return { transactions, accounts, categories };
  },
  component: () => {
    const { transactions, accounts, categories } = useLoaderData({
      from: "/transactions",
    });
    const [selectedRows, setSelectedRows] = useState<TransactionRow[]>([]);
    const columns = useMemo(
      () => buildTransactionsTableColumns({ accounts, categories }),
      [accounts, categories],
    );
    const transactionsByDay = useMemo(() => {
      const byDay = new Map<string, TransactionRow[]>();
      for (const row of transactions) {
        const day = getDayKey(row.createdAt);
        const dayRows = byDay.get(day);
        if (dayRows) dayRows.push(row);
        else byDay.set(day, [row]);
      }
      return byDay;
    }, [transactions]);

    return (
      <PageContainer>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Title variant="page">Transactions</Title>
          <div className="flex flex-wrap gap-2">
            {selectedRows.length > 0 && (
              <DeleteSelectedTransactionsButton ids={selectedRows.map((row) => row.id)} />
            )}
            <NavLink
              className="border-border bg-surface border"
              to="/transactions-import"
              icon={<UploadIcon />}
            >
              Import
            </NavLink>
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
          groupBy={(row) => getDayKey(row.createdAt)}
          renderGroupSummary={(day) => (
            <DaySummary rows={transactionsByDay.get(day as string) ?? []} />
          )}
        />
      </PageContainer>
    );
  },
});
