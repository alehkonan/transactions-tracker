import { Loader2Icon, TrashIcon } from "lucide-react";
import { use, useTransition } from "react";
import { Button } from "~/components/Button";
import { DialogContext } from "~/components/Dialog";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import { deleteTransactions } from "~/modules/transactions/transaction-mutations";

type Props = {
  id: string;
};

/** Deletes the transaction being edited, after confirmation, then closes the form. */
export function DeleteTransactionButton({ id }: Props) {
  const { onClose } = use(DialogContext);
  const [isDeleting, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await deleteTransactions([id]);
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
        message="Delete this transaction?"
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </Popover>
  );
}
