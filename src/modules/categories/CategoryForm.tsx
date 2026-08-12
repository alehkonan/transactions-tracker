import { Field } from "@base-ui/react/field";
import { TrashIcon } from "lucide-react";
import { useContext, useState, useTransition } from "react";
import { useController, useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { createCategory, deleteCategory, updateCategory } from "~/api/category.functions";
import { Button } from "~/components/Button";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { DialogContext } from "~/components/Dialog";
import { InputControl } from "~/components/InputControl";
import { syncNow } from "~/modules/sync/useSyncStore";
import type { CategoryRow } from "~/modules/categories/to-category-rows";
import type { Color } from "~/modules/sync/sync-types";

type CategoryFormValues = {
  name: string;
  colorId: number | null;
};

type Props = {
  /** The palette to pick from — the `colors` table rows, the only colors a category can take. */
  colors: Color[];
  /** When set, the form edits this existing category instead of creating a new one. */
  category?: CategoryRow;
};

function getDefaultValues(category?: CategoryRow): CategoryFormValues {
  return {
    name: category?.name ?? "",
    colorId: category?.colorId ?? null,
  };
}

/** Creates a category, or renames/recolors/deletes an existing one — the single editor behind a category tag. */
export function CategoryForm({ colors, category }: Props) {
  const { onClose } = useContext(DialogContext);
  const isEditing = Boolean(category);
  const { control, handleSubmit, reset, formState } = useForm<CategoryFormValues>({
    defaultValues: getDefaultValues(category),
  });
  const { field: colorField, fieldState: colorState } = useController({
    control,
    name: "colorId",
    rules: { validate: (colorId) => colorId != null || "Pick a color." },
  });
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  const handleDelete = () => {
    if (!category) return;
    startDeleteTransition(async () => {
      await deleteCategory({ data: category.id });
      onClose();
      await syncNow();
    });
  };

  const onSubmit = handleSubmit(async ({ name, colorId }) => {
    // The validation rule above already rejected a missing color; this only narrows the type.
    if (colorId == null) return;

    if (category) {
      await updateCategory({ data: { id: category.id, name, colorId } });
    } else {
      await createCategory({ data: { name, colorId } });
      reset(getDefaultValues());
    }

    onClose();
    // Not awaited: the change can come back through a pull after the dialog closes.
    void syncNow();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3">
      <InputControl control={control} name="name" label="Name" rules={{ required: true }} />
      <Field.Root className="flex flex-col gap-1">
        <Field.Label className="text-text text-sm font-bold">Color</Field.Label>
        {colors.length === 0 ? (
          <p className="text-text-muted text-sm">No colors in the palette yet.</p>
        ) : (
          <div className="border-border bg-surface flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-lg border p-2">
            {colors.map((color) => (
              <button
                key={color.id}
                type="button"
                aria-label={`Color ${color.hex}`}
                aria-pressed={color.id === colorField.value}
                onClick={() => colorField.onChange(color.id)}
                onBlur={colorField.onBlur}
                className={twMerge(
                  "size-7 rounded-full border-2 transition-transform",
                  color.id === colorField.value
                    ? "border-text scale-110"
                    : "border-transparent hover:scale-110",
                )}
                style={{ backgroundColor: color.hex }}
              />
            ))}
          </div>
        )}
        {colorState.error && (
          <Field.Description className="text-danger text-sm">
            {colorState.error.message}
          </Field.Description>
        )}
      </Field.Root>
      <div className="flex items-center justify-between gap-2">
        {category && (
          <Button
            variant="danger"
            type="button"
            disabled={isDeleting}
            onClick={() => setDeleteOpen(true)}
          >
            <TrashIcon className="size-4" />
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={formState.isSubmitting}>
            {isEditing ? "Save" : "Create"}
          </Button>
        </div>
      </div>
      {category && (
        <ConfirmDialog
          open={isDeleteOpen}
          onOpenChange={setDeleteOpen}
          title="Remove category"
          message={`Delete category "${category.name}"? Transactions using it will lose their category.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDelete}
        />
      )}
    </form>
  );
}
