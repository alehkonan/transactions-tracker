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
    setTimeout(() => {
      navigate({ search: (prev) => ({ ...prev, category }) });
    }, 0);
  };

  const handleReset = () => navigate({ search: (prev) => ({ ...prev, category: undefined }) });

  return (
    <Select
      options={categories.map((category) => category.name)}
      value={selected}
      onValueChange={handleValueChange}
      onReset={selected ? handleReset : undefined}
      placeholder="All categories"
      className="min-w-40"
    />
  );
}
