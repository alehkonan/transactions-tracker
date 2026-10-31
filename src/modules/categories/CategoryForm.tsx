import { TrashIcon } from "lucide-react";
import { useId, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { Button } from "~/components/Button";
import { InputControl } from "~/components/InputControl";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "~/modules/categories/category-mutations";
import { getCategoryDisplayColor } from "~/modules/categories/category-palette";
import { useFormTask } from "~/modules/forms/form-task";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
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
  const replicaContext = useReplicaBinding();
  const profileId = useSelectedProfileId();
  const isEditing = Boolean(category);
  const { control, handleSubmit, reset, setError, formState } = useForm<CategoryFormValues>({
    defaultValues: getDefaultValues(category),
  });
  const colorErrorId = useId();
  const { field: colorField, fieldState: colorState } = useController({
    control,
    name: "colorId",
    rules: { validate: (colorId) => colorId != null || "Pick a color." },
  });
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!category || !replicaContext) return;
    setIsDeleting(true);
    try {
      await deleteCategory(category.id, replicaContext);
      onComplete();
    } finally {
      setIsDeleting(false);
    }
  };

  const { onCancel, onComplete } = useFormTask({
    isDirty: formState.isDirty,
    isPending: formState.isSubmitting || isDeleting,
  });

  const onSubmit = handleSubmit(async ({ name, colorId }) => {
    try {
      // The validation rule above already rejected a missing color; this only narrows the type.
      if (colorId == null) return;

      if (profileId == null || !replicaContext)
        throw new Error("Your local profile is unavailable. Reopen the form and try again.");

      if (category) {
        await updateCategory(category.id, name, colorId, replicaContext);
      } else {
        await createCategory(profileId, name, colorId, replicaContext);
        reset(getDefaultValues());
      }

      onComplete();
    } catch (cause) {
      setError("root", {
        message: cause instanceof Error ? cause.message : "Could not save your changes. Try again.",
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3" data-testid="category-form">
      {formState.errors.root?.message && (
        <p role="alert" className="text-danger text-sm">
          {formState.errors.root.message}
        </p>
      )}
      <InputControl
        control={control}
        name="name"
        data-testid="category-name"
        label="Name"
        rules={{ required: "Category name is required." }}
        autoCapitalize="words"
        enterKeyHint="next"
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-text text-sm font-bold">Color</legend>
        {colors.length === 0 ? (
          <p className="text-text-muted text-sm">No colors in the palette yet.</p>
        ) : (
          <div className="border-border bg-surface flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-lg border p-2">
            {colors.map((color, index) => (
              <label
                key={color.id}
                className="grid size-11 cursor-pointer place-items-center rounded-full sm:size-9"
              >
                <input
                  ref={index === 0 ? colorField.ref : undefined}
                  type="radio"
                  name={colorField.name}
                  value={color.id}
                  checked={color.id === colorField.value}
                  aria-label={`Color option ${color.id}`}
                  aria-describedby={colorState.error ? colorErrorId : undefined}
                  onChange={() => colorField.onChange(color.id)}
                  onBlur={colorField.onBlur}
                  className="peer sr-only"
                />
                <span
                  className={twMerge(
                    "peer-focus-visible:ring-accent block size-7 rounded-full border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:outline-none",
                    color.id === colorField.value ? "border-text" : "border-transparent",
                  )}
                  style={{ backgroundColor: getCategoryDisplayColor(color.id) }}
                />
              </label>
            ))}
          </div>
        )}
        {colorState.error && (
          <p id={colorErrorId} className="text-danger text-sm">
            {colorState.error.message}
          </p>
        )}
      </fieldset>
      <div className="flex items-center justify-between gap-2">
        {category && (
          <Popover
            sheet
            aria-label="Remove category"
            renderTrigger={({ onOpen }) => (
              <Button variant="danger" type="button" disabled={isDeleting} onClick={onOpen}>
                <TrashIcon className="size-4" />
                Delete
              </Button>
            )}
          >
            <PopoverConfirm
              title="Remove category"
              message={`Delete category "${category.name}"? Transactions using it will lose their category.`}
              confirmLabel="Delete"
              confirmVariant="danger"
              onConfirm={handleDelete}
            />
          </Popover>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={onCancel}
            data-testid="category-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={formState.isSubmitting}
            data-testid="category-submit"
          >
            {isEditing ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </form>
  );
}
