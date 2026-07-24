import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { AddTransactionButton } from "~/features/add-transaction/AddTransactionButton";
import { TransactionsImportButton } from "~/features/transactions-import/TransactionsImportButton";
import { getTransactions } from "~/utils/transaction.functions";

export const Route = createFileRoute("/transactions")({
  loader: () => getTransactions(),
  component: () => {
    const transactions = useLoaderData({
      from: "/transactions",
    });

    return (
      <PageContainer>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Title variant="page">Transactions</Title>
          <div className="flex flex-wrap gap-2">
            <TransactionsImportButton />
            <AddTransactionButton />
          </div>
        </div>
        {transactions.length === 0 ? (
          <p className="text-slate-600 dark:text-slate-400">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="px-4 py-2 font-semibold">ID</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Amount</th>
                  <th className="px-4 py-2 font-semibold">From</th>
                  <th className="px-4 py-2 font-semibold">To</th>
                  <th className="px-4 py-2 font-semibold">Category</th>
                  <th className="px-4 py-2 font-semibold">Necessity</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr
                    key={transaction.id}
                    className="border-b border-slate-200 text-slate-800 dark:border-slate-800 dark:text-slate-200"
                  >
                    <td className="px-4 py-2">{transaction.id}</td>
                    <td className="px-4 py-2">{transaction.type}</td>
                    <td className="px-4 py-2">{transaction.amount}</td>
                    <td className="px-4 py-2">{transaction.srcAccountId ?? "—"}</td>
                    <td className="px-4 py-2">{transaction.destAccountId ?? "—"}</td>
                    <td className="px-4 py-2">{transaction.categoryId ?? "—"}</td>
                    <td className="px-4 py-2">{transaction.necessityLevel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageContainer>
    );
  },
});
