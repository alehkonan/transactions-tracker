import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { CategoryTag } from "~/modules/categories/CategoryTag";
import { CreateCategoryButton } from "~/modules/categories/CreateCategoryButton";
import { useCategories } from "~/modules/categories/useCategories";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { useSyncStore } from "~/modules/sync/useSyncStore";

export function CategoriesScreen() {
  const categories = useCategories();
  const colors = useSyncStore((state) => state.colors);
  const profiles = useSyncStore((state) => state.profiles);
  const profileId = useSelectedProfileId();
  const profile = profiles.find((candidate) => candidate.id === profileId);

  return (
    <PageContainer>
      <main className="mx-auto">
        <PageHeader title="Categories" backTo="/settings" backLabel="Settings" />
        <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-text-muted min-w-0 text-sm wrap-anywhere">
            Categories for {profile?.name ?? "the current profile"}. Select one to edit it.
          </p>
          <CreateCategoryButton colors={colors} />
        </div>
        {categories.length === 0 ? (
          <div className="bg-surface rounded-lg p-4">
            <h2 className="font-semibold">No categories yet</h2>
            <p className="text-text-muted mt-1 text-sm">
              Add a category to organize this profile’s income and expenses.
            </p>
          </div>
        ) : (
          <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg">
            {categories.map((category) => (
              <li key={category.id}>
                <CategoryTag category={category} colors={colors} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </PageContainer>
  );
}
