import type { Color, SyncedCategory } from "~/modules/sync/sync-types";

/** A category with its color resolved from the shared palette, which is all the UI ever draws. */
export type CategoryRow = {
  id: string;
  name: string;
  colorId: number | null;
  colorHex: string | null;
};

/** Joins categories to the palette and sorts them by name, as the old `getCategories` query did. */
export function toCategoryRows(categories: SyncedCategory[], colors: Color[]): CategoryRow[] {
  const hexById = new Map(colors.map((color) => [color.id, color.hex]));

  return categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      colorId: category.colorId,
      colorHex: category.colorId != null ? (hexById.get(category.colorId) ?? null) : null,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
