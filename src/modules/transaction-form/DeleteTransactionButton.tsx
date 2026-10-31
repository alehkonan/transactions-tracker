import { Loader2Icon, TrashIcon } from "lucide-react";
import { use, useState } from "react";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import { FormTaskContext } from "~/modules/forms/form-task";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { deleteTransactions } from "~/modules/transactions/transaction-mutations";

type Props = {
  id: string;
};

/** Deletes the transaction being edited, after confirmation, then closes the form. */
export function DeleteTransactionButton({ id }: Props) {
  const { onComplete } = use(FormTaskContext);
  const replicaContext = useReplicaBinding();
  const isLinked = useSyncStore((state) =>
    Boolean(state.transactions.find((row) => row.id === id)?.transferId),
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    if (!replicaContext) return;
    setIsDeleting(true);
    try {
      await deleteTransactions([id], replicaContext);
      onComplete();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Popover
      sheet
      aria-label="Delete transaction"
      renderTrigger={({ onOpen }) => (
        <Button
          data-testid="transaction-delete"
          variant="danger"
          type="button"
          disabled={isDeleting}
          onClick={onOpen}
        >
          {isDeleting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <TrashIcon className="size-4" />
          )}
          Delete
        </Button>
      )}
    >
      <PopoverConfirm
        message={isLinked ? "Delete both sides of this transfer?" : "Delete this transaction?"}
        confirmLabel="Delete"
        confirmTestId="transaction-delete-confirm"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </Popover>
  );
}
