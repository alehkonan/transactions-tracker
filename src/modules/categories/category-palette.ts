export const CATEGORY_DISPLAY_COLORS = [
  "#9c6728",
  "#b1782f",
  "#c18a3d",
  "#a6532f",
  "#914237",
  "#75483c",
  "#675044",
  "#7b5d2c",
  "#676232",
  "#59683b",
  "#4f6b50",
  "#765344",
  "#7a4c60",
  "#674b5b",
  "#845c45",
  "#98613b",
] as const;

/** Keeps persisted palette ids stable while rendering every category inside the product's print palette. */
export function getCategoryDisplayColor(colorId: number): string {
  const index =
    (((colorId - 1) % CATEGORY_DISPLAY_COLORS.length) + CATEGORY_DISPLAY_COLORS.length) %
    CATEGORY_DISPLAY_COLORS.length;
  return CATEGORY_DISPLAY_COLORS[index];
}
