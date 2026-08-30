import { Dialog } from "~/components/Dialog";
import { TransactionForm } from "~/modules/transaction-form/TransactionForm";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { CategoryRow } from "~/modules/categories/to-category-rows";

type Props = {
  accounts: AccountWithBalance[];
  categories: CategoryRow[];
};

/** A transaction-row-shaped action that opens the creation form at the end of the list. */
export function CreateTransactionButton({ accounts, categories }: Props) {
  return (
    <Dialog
      title="Add transaction"
      renderTrigger={({ onOpen }) => (
        <button
          type="button"
          onClick={onOpen}
          className="border-border bg-surface hover:bg-surface-muted focus-visible:ring-accent flex min-h-15 w-full flex-col justify-center rounded-xl border px-3 py-1 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <span className="text-sm font-medium">Add new transaction</span>
          <span className="text-text-muted mt-1 text-xs">Income, expense, or transfer</span>
        </button>
      )}
    >
      <TransactionForm accounts={accounts} categories={categories} />
    </Dialog>
  );
}
