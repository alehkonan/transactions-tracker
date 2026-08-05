import { useRouter } from "@tanstack/react-router";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useTransition } from "react";
import { deleteAllAccounts } from "~/api/account.functions";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";

type Props = {
  disabled?: boolean;
};

/** Icon button that deletes every account, after confirmation, and refreshes the page. */
export function DeleteAllAccountsButton({ disabled }: Props) {
  const router = useRouter();
  const [isDeleting, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await deleteAllAccounts();
      await router.invalidate();
    });
  };

  return (
    <Popover
      renderTrigger={({ onOpen }) => (
        <Button
          variant="danger"
          aria-label="Delete all accounts"
          disabled={disabled || isDeleting}
          onClick={onOpen}
          className="size-8 shrink-0 rounded-lg p-0"
        >
          {isDeleting ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
        </Button>
      )}
    >
      <PopoverConfirm
        message="Delete all accounts? This also deletes all of their transactions."
        confirmLabel="Delete all"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </Popover>
  );
}
