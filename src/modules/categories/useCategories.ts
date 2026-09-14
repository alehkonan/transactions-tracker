import { useMemo } from "react";
import { toCategoryRows } from "~/modules/categories/to-category-rows";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { CategoryRow } from "~/modules/categories/to-category-rows";

/** The selected profile's categories, name-sorted, each with its color from the shared palette. */
export function useCategories(): CategoryRow[] {
  const profileId = useSelectedProfileId();
  const categories = useSyncStore((state) => state.categories);
  const colors = useSyncStore((state) => state.colors);

  return useMemo(() => {
    if (profileId == null) return [];

    return toCategoryRows(
      categories.filter((category) => category.profileId === profileId),
      colors,
    );
  }, [categories, colors, profileId]);
}
