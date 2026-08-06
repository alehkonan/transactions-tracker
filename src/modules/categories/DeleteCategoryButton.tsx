import { useRouter } from "@tanstack/react-router";
import { Loader2Icon, TrashIcon } from "lucide-react";
import { useTransition } from "react";
import { deleteCategory } from "~/api/category.functions";
import { Button } from "~/components/Button";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";

type Props = {
  id: number;
  name: string;
};

/** Icon button that deletes a category, after confirmation, and refreshes the page. */
export function DeleteCategoryButton({ id, name }: Props) {
  const router = useRouter();
  const [isDeleting, startTransition] = useTransition();

  const handleConfirm = () => {
    startTransition(async () => {
      await deleteCategory({ data: id });
      await router.invalidate();
    });
  };

  return (
    <Popover
      renderTrigger={({ onOpen }) => (
        <Button
          variant="danger"
          aria-label={`Delete category ${name}`}
          disabled={isDeleting}
          onClick={onOpen}
          className="size-8 shrink-0 rounded-lg p-0"
        >
          {isDeleting ? <Loader2Icon className="animate-spin" /> : <TrashIcon />}
        </Button>
      )}
    >
      <PopoverConfirm
        message={`Delete category "${name}"?`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleConfirm}
      />
    </Popover>
  );
}
