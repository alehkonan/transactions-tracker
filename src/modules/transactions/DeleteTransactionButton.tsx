import { useRouter } from "@tanstack/react-router";
import { Loader2Icon, TrashIcon } from "lucide-react";
import { useTransition } from "react";
import { deleteTransactions } from "~/api/transaction.functions";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";

type DeleteTransactionButtonProps = {
  id: number;
};

/** Icon button that deletes a single transaction row, after confirmation, and refreshes the table. */
export function DeleteTransactionButton({ id }: DeleteTransactionButtonProps) {
  const router = useRouter();
  const [isDeleting, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await deleteTransactions({ data: [id] });
      await router.invalidate();
    });
  };

  return (
    <Popover
      renderTrigger={({ onOpen }) => (
        <Button
          variant="danger"
          aria-label="Delete transaction"
          disabled={isDeleting}
          onClick={onOpen}
          className="mx-auto size-8 rounded-lg p-0"
        >
          {isDeleting ? <Loader2Icon className="animate-spin" /> : <TrashIcon />}
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
