import { Loader2Icon, TrashIcon } from "lucide-react";
import { use, useTransition } from "react";
import { Button } from "~/components/Button";
import { DialogContext } from "~/components/Dialog";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { deleteTransactions } from "~/modules/transactions/transaction-mutations";

type Props = {
  id: string;
};

/** Deletes the transaction being edited, after confirmation, then closes the form. */
export function DeleteTransactionButton({ id }: Props) {
  const { onClose } = use(DialogContext);
  const replicaContext = useReplicaBinding();
  const isLinked = useSyncStore((state) =>
    Boolean(state.transactions.find((row) => row.id === id)?.transferId),
  );
  const [isDeleting, startTransition] = useTransition();

  const handleConfirm = () => {
    if (!replicaContext) return;
    startTransition(async () => {
      await deleteTransactions([id], replicaContext);
      onClose();
    });
  };

  return (
    <Popover
      renderTrigger={({ onOpen }) => (
        <Button variant="danger" type="button" disabled={isDeleting} onClick={onOpen}>
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
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </Popover>
  );
}
