import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { PlusIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { getTransactions, type TransactionRow } from "~/api/transaction.functions";
import { Button } from "~/components/Button";
import { DataTable } from "~/components/DataTable";
import { Dialog } from "~/components/Dialog";
import { NavLink } from "~/components/NavLink";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { DeleteSelectedTransactionsButton } from "~/modules/transactions/DeleteSelectedTransactionsButton";
import { TransactionForm } from "~/modules/transactions/TransactionForm";
import { transactionsTableColumns } from "~/modules/transactions/transactionsTableColumns";

export const Route = createFileRoute("/transactions")({
  loader: () => {
    return getTransactions();
  },
  component: () => {
    const transactions = useLoaderData({
      from: "/transactions",
    });
    const [selectedRows, setSelectedRows] = useState<TransactionRow[]>([]);

    return (
      <PageContainer>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Title variant="page">Transactions</Title>
          <div className="flex flex-wrap gap-2">
            {selectedRows.length > 0 && (
              <DeleteSelectedTransactionsButton ids={selectedRows.map((row) => row.id)} />
            )}
            <Dialog
              title="Add transaction"
              renderTrigger={({ onOpen }) => (
                <Button variant="primary" onClick={onOpen}>
                  <PlusIcon />
                  <span className="hidden sm:block">Add transaction</span>
                </Button>
              )}
            >
              <TransactionForm />
            </Dialog>
            <NavLink
              className="border-border bg-surface border"
              to="/transactions-import"
              icon={<UploadIcon />}
            >
              Import
            </NavLink>
          </div>
        </div>
        <div className="py-4" />
        <DataTable
          columns={transactionsTableColumns}
          data={transactions}
          enableRowSelection
          onSelectionChange={setSelectedRows}
        />
      </PageContainer>
    );
  },
});
