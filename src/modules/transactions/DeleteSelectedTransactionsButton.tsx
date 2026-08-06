import { useRouter } from "@tanstack/react-router";
import { TrashIcon } from "lucide-react";
import { useTransition } from "react";
import { deleteTransactions } from "~/api/transaction.functions";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";

type DeleteSelectedTransactionsButtonProps = {
  ids: number[];
};

/** Batch-deletes the given transaction ids, after confirmation, and refreshes the table. */
export function DeleteSelectedTransactionsButton({ ids }: DeleteSelectedTransactionsButtonProps) {
  const router = useRouter();
  const [isDeleting, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await deleteTransactions({ data: ids });
      await router.invalidate();
    });
  };

  return (
    <Popover
      renderTrigger={({ onOpen }) => (
        <Button variant="danger" disabled={isDeleting} onClick={onOpen}>
          <TrashIcon />
          {isDeleting ? "Deleting…" : `Delete rows (${ids.length})`}
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
