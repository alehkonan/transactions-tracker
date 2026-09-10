import { useNavigate } from "@tanstack/react-router";
import { Select } from "~/components/Select";
import type { CategoryRow } from "~/modules/categories/to-category-rows";

type Props = {
  categories: CategoryRow[];
  selected?: string;
};

/**
 * Category filter for the transactions table; drives the `category` route search param (matched by
 * category name, like the account filter), so each pick re-runs the filter. Picking the placeholder
 * item reports `undefined`, which drops the param and brings every category back.
 */
export function TransactionsCategoryFilter({ categories, selected }: Props) {
  const navigate = useNavigate({ from: "/transactions" });

  const handleValueChange = (category: string | undefined) => {
    void navigate({ search: (prev) => ({ ...prev, category }) });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor="transaction-category-filter" className="text-text text-sm font-bold">
        Category
      </label>
      <Select
        id="transaction-category-filter"
        options={categories.map((category) => category.name)}
        value={selected}
        onValueChange={handleValueChange}
        placeholder="All categories"
        className="w-full md:min-w-40"
      />
    </div>
  );
}
