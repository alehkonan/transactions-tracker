import { describe, expect, it } from "vitest";
import { CATEGORY_DISPLAY_COLORS, getCategoryDisplayColor } from "./category-palette";

describe("getCategoryDisplayColor", () => {
  it("maps persisted ids into the branded palette deterministically", () => {
    expect(getCategoryDisplayColor(1)).toBe(CATEGORY_DISPLAY_COLORS[0]);
    expect(getCategoryDisplayColor(CATEGORY_DISPLAY_COLORS.length + 1)).toBe(
      CATEGORY_DISPLAY_COLORS[0],
    );
    expect(getCategoryDisplayColor(7)).toBe(getCategoryDisplayColor(7));
  });
});
