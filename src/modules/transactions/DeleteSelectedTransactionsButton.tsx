import { TrashIcon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import { deleteTransactions } from "~/modules/transactions/transaction-mutations";

type DeleteSelectedTransactionsButtonProps = {
  ids: string[];
};

/** Batch-deletes the given transaction ids, after confirmation, and refreshes the table. */
export function DeleteSelectedTransactionsButton({ ids }: DeleteSelectedTransactionsButtonProps) {
  const [isDeleting, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await deleteTransactions(ids);
    });
  };

  return (
    <Popover
      renderTrigger={({ onOpen }) => (
        <Button variant="danger" disabled={isDeleting} onClick={onOpen}>
          <TrashIcon />
          {isDeleting
            ? "Deleting…"
            : `Delete ${ids.length} transaction${ids.length === 1 ? "" : "s"}`}
        </Button>
      )}
    >
      <PopoverConfirm
        message={`Delete ${ids.length} transaction${ids.length === 1 ? "" : "s"}?`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </Popover>
  );
}
