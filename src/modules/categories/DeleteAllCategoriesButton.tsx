import { useRouter } from "@tanstack/react-router";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useTransition } from "react";
import { deleteAllCategories } from "~/api/category.functions";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";

type Props = {
  disabled?: boolean;
};

/** Icon button that deletes every category, after confirmation, and refreshes the page. */
export function DeleteAllCategoriesButton({ disabled }: Props) {
  const router = useRouter();
  const [isDeleting, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await deleteAllCategories();
      await router.invalidate();
    });
  };

  return (
    <Popover
      renderTrigger={({ onOpen }) => (
        <Button
          variant="danger"
          aria-label="Delete all categories"
          disabled={disabled || isDeleting}
          onClick={onOpen}
          className="size-8 shrink-0 rounded-lg p-0"
        >
          {isDeleting ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
        </Button>
      )}
    >
      <PopoverConfirm
        message="Delete all categories? Transactions using them will lose their category."
        confirmLabel="Delete all"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </Popover>
  );
}
