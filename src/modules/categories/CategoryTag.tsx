import { PencilIcon } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { Dialog } from "~/components/Dialog";
import { CategoryForm } from "~/modules/categories/CategoryForm";
import type { CategoryRow } from "~/modules/categories/to-category-rows";
import type { Color } from "~/modules/sync/sync-types";

type Props =
  | {
      /** Editable: a list row opens the sheet to rename, recolor, or delete the category. */
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

/** A read-only category pill, or a full-width management row when editable. */
export function CategoryTag(props: Props) {
  const name = props.category?.name ?? props.name;
  const colorHex = props.category?.colorHex ?? props.colorHex;

  const tag = (
    <span
      className={twMerge(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-center text-xs font-medium whitespace-nowrap",
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
          className="hover:bg-surface-hover focus-visible:ring-accent flex min-h-11 w-full cursor-pointer items-center gap-3 p-4 text-left focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
        >
          <span
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: colorHex ?? "var(--color-text-muted)" }}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 wrap-anywhere">{name}</span>
          <PencilIcon className="text-text-muted size-4 shrink-0" aria-hidden="true" />
        </button>
      )}
    >
      <CategoryForm category={props.category} colors={props.colors} />
    </Dialog>
  );
}
