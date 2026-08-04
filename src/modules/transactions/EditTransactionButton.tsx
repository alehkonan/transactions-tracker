import { PencilIcon } from "lucide-react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { TransactionForm } from "~/modules/transaction-form/TransactionForm";
import type { getAccounts } from "~/api/account.functions";
import type { getCategories } from "~/api/category.functions";
import type { TransactionRow } from "~/api/transaction.functions";

type Props = {
  transaction: TransactionRow;
  accounts: Awaited<ReturnType<typeof getAccounts>>;
  categories: Awaited<ReturnType<typeof getCategories>>;
};

/** Icon button that opens the same form as "Add transaction", prefilled to edit this row. */
export function EditTransactionButton({ transaction, accounts, categories }: Props) {
  return (
    <Dialog
      title="Update transaction"
      renderTrigger={({ onOpen }) => (
        <Button
          variant="secondary"
          aria-label="Edit transaction"
          onClick={onOpen}
          className="mx-auto size-8 rounded-lg p-0"
        >
          <PencilIcon />
        </Button>
      )}
    >
      <TransactionForm accounts={accounts} categories={categories} transaction={transaction} />
    </Dialog>
  );
}
