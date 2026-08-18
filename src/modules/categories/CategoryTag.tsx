import { twMerge } from "tailwind-merge";
import { Dialog } from "~/components/Dialog";
import { CategoryForm } from "~/modules/categories/CategoryForm";
import type { CategoryRow } from "~/modules/categories/to-category-rows";
import type { Color } from "~/modules/sync/sync-types";

type Props =
  | {
      /** Editable: clicking the tag opens the dialog that renames, recolors or deletes the category. */
      category: CategoryRow;
      colors: Color[];
      name?: undefined;
      colorHex?: undefined;
    }
  | {
      /** Read-only: just the two things the tag draws (e.g. a joined transactions row). */
      name?: string | null;
      colorHex?: string | null;
      category?: undefined;
      colors?: undefined;
    };

/** Category pill tinted with that category's own color, picked from the shared palette. */
export function CategoryTag(props: Props) {
  const name = props.category?.name ?? props.name;
  const colorHex = props.category?.colorHex ?? props.colorHex;

  const tag = (
    <span
      className={twMerge(
        "inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-center text-xs font-medium whitespace-nowrap",
        !name && "border-border text-text-muted",
      )}
      style={
        name && colorHex
          ? {
              backgroundColor: `color-mix(in srgb, ${colorHex} 15%, transparent)`,
              borderColor: `color-mix(in srgb, ${colorHex} 40%, transparent)`,
              color: colorHex,
            }
          : undefined
      }
    >
      {name ?? "No category"}
    </span>
  );

  if (!props.category) return tag;

  return (
    <Dialog
      title="Edit category"
      renderTrigger={({ onOpen }) => (
        <button
          type="button"
          aria-label={`Edit category ${props.category.name}`}
          onClick={onOpen}
          // The pill keeps its size; the button around it grows to a thumb-sized target on a phone,
          // since these chips are the only way to edit a category.
          className="inline-flex min-h-11 max-w-full items-center rounded-full transition-[box-shadow] hover:shadow sm:min-h-0"
        >
          {tag}
        </button>
      )}
    >
      <CategoryForm category={props.category} colors={props.colors} />
    </Dialog>
  );
}
