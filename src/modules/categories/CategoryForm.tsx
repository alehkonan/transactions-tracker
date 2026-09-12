import { TrashIcon } from "lucide-react";
import { useContext, useId, useTransition } from "react";
import { useController, useForm } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { Button } from "~/components/Button";
import { DialogContext } from "~/components/Dialog";
import { InputControl } from "~/components/InputControl";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "~/modules/categories/category-mutations";
import { getCategoryDisplayColor } from "~/modules/categories/category-palette";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { useSyncStore } from "~/modules/sync/useSyncStore";
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
  const replicaContext = useSyncStore((state) => state.replicaContext);
  const isEditing = Boolean(category);
  const { control, handleSubmit, reset, formState } = useForm<CategoryFormValues>({
    defaultValues: getDefaultValues(category),
  });
  const colorErrorId = useId();
  const { field: colorField, fieldState: colorState } = useController({
    control,
    name: "colorId",
    rules: { validate: (colorId) => colorId != null || "Pick a color." },
  });
  const [isDeleting, startDeleteTransition] = useTransition();

  const handleDelete = () => {
    if (!category || !replicaContext) return;
    startDeleteTransition(async () => {
      await deleteCategory(category.id, replicaContext);
      onClose();
    });
  };

  const onSubmit = handleSubmit(async ({ name, colorId }) => {
    // The validation rule above already rejected a missing color; this only narrows the type.
    if (colorId == null) return;

    const profileId = readSelectedProfileId();
    if (profileId == null || !replicaContext) return;

    if (category) {
      await updateCategory(category.id, name, colorId, replicaContext);
    } else {
      await createCategory(profileId, name, colorId, replicaContext);
      reset(getDefaultValues());
    }

    onClose();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3">
      <InputControl
        control={control}
        name="name"
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
                    "peer-focus-visible:ring-accent block size-7 rounded-full border-2 transition-transform peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:outline-none",
                    color.id === colorField.value
                      ? "border-text scale-110"
                      : "border-transparent hover:scale-110",
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
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={formState.isSubmitting}>
            {isEditing ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </form>
  );
}
