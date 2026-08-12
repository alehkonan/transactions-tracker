import { useMemo } from "react";
import { toCategoryRows } from "~/modules/categories/to-category-rows";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { CategoryRow } from "~/modules/categories/to-category-rows";

/** The selected profile's categories, name-sorted, each with its color from the shared palette. */
export function useCategories(): CategoryRow[] {
  const profileId = readSelectedProfileId();
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
