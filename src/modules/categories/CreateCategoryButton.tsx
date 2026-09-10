import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { CategoryForm } from "~/modules/categories/CategoryForm";
import type { Color } from "~/modules/sync/sync-types";

type Props = {
  /** The palette the new category picks its color from. */
  colors: Color[];
};

/** Opens the dialog used to add a category to the selected profile. */
export function CreateCategoryButton({ colors }: Props) {
  return (
    <Dialog
      title="Add category"
      renderTrigger={({ onOpen }) => (
        <Button variant="secondary" onClick={onOpen}>
          Add category
        </Button>
      )}
    >
      <CategoryForm colors={colors} />
    </Dialog>
  );
}
