import { PencilIcon } from "lucide-react";
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
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border text-center font-medium whitespace-nowrap",
        props.category
          ? "min-h-11 px-3 py-1.5 text-sm sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-xs"
          : "px-2 py-0.5 text-xs",
        !name && "border-border text-text-muted",
      )}
      style={
        name && colorHex
          ? {
              backgroundColor: `color-mix(in oklab, ${colorHex} 18%, transparent)`,
              borderColor: `color-mix(in oklab, ${colorHex} 48%, transparent)`,
              color: `color-mix(in oklab, ${colorHex} 40%, var(--color-text))`,
            }
          : undefined
      }
    >
      {name ?? "No category"}
      {props.category && <PencilIcon className="size-3 shrink-0" aria-hidden="true" />}
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
          // Editable chips are thumb-sized on phones because they are the only route to category editing;
          // the visual chip itself owns that height so wrapped rows keep an honest, even rhythm.
          className="focus-visible:ring-accent inline-flex max-w-full cursor-pointer items-center rounded-full transition-shadow hover:shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {tag}
        </button>
      )}
    >
      <CategoryForm category={props.category} colors={props.colors} />
    </Dialog>
  );
}
