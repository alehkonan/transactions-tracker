import { PlusIcon } from "lucide-react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { CategoryForm } from "~/modules/categories/CategoryForm";
import type { getColors } from "~/api/color.functions";

type Color = Awaited<ReturnType<typeof getColors>>[number];

type Props = {
  /** The palette the new category picks its color from. */
  colors: Color[];
};

/** Icon button that opens a dialog to create a new category. */
export function CreateCategoryButton({ colors }: Props) {
  return (
    <Dialog
      title="Add category"
      renderTrigger={({ onOpen }) => (
        <Button variant="primary" aria-label="Add category" onClick={onOpen}>
          <PlusIcon className="size-6" />
        </Button>
      )}
    >
      <CategoryForm colors={colors} />
    </Dialog>
  );
}
