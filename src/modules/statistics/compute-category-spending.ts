import { addMonths, parse, startOfMonth } from "date-fns";
import { toUsd } from "~/utils/money";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { CategoryRow } from "~/modules/categories/to-category-rows";
import type { SyncedTransaction } from "~/modules/sync/sync-types";

export type CategorySpending = {
  categoryId: string | null;
  name: string;
  colorHex: string | null;
  /** How many transactions made up the total. */
  count: number;
  totalUsd: number;
  /** The category's share of the month's total, 0–1 — what sizes the bar. */
  share: number;
};

type Options = {
  transactions: SyncedTransaction[];
  accounts: AccountWithBalance[];
  categories: CategoryRow[];
  usdRates: Record<string, number>;
  /** The month to break down, as `yyyy-MM`. */
  month: string;
};

/**
 * Where a month's spending went, ranked by USD total, largest first.
 *
 * Same month bounds and currency handling as `computeMonthlySpendingTrend`: local month edges, and
 * every amount converted to USD at the account's rate so categories can be compared on one axis.
 * Rows whose category was deleted since group under "No category", like the rest of the app.
 */
export function computeCategorySpending({
  transactions,
  accounts,
  categories,
  usdRates,
  month,
}: Options): CategorySpending[] {
  const monthStart = startOfMonth(parse(month, "yyyy-MM", new Date()));
  const monthEnd = addMonths(monthStart, 1);
  const currencyByAccount = new Map(accounts.map((account) => [account.id, account.currencyCode]));
  const nameById = new Map(categories.map((category) => [category.id, category.name]));
  const colorById = new Map(categories.map((category) => [category.id, category.colorHex]));

  const totals = new Map<string | null, { totalUsd: number; count: number }>();
  for (const transaction of transactions) {
    if (transaction.type !== "EXPENSE") continue;
    if (transaction.createdAt < monthStart || transaction.createdAt >= monthEnd) continue;

    const currencyCode =
      transaction.accountId != null ? currencyByAccount.get(transaction.accountId) : undefined;
    // No account means no currency to convert from, so the row cannot be placed on a USD axis.
    if (currencyCode == null) continue;

    const entry = totals.get(transaction.categoryId) ?? { totalUsd: 0, count: 0 };
    entry.totalUsd += Math.abs(toUsd(transaction.amount, currencyCode, usdRates));
    entry.count += 1;
    totals.set(transaction.categoryId, entry);
  }

  const total = [...totals.values()].reduce((sum, entry) => sum + entry.totalUsd, 0);
  if (total === 0) return [];

  return [...totals]
    .map(([categoryId, entry]) => ({
      categoryId,
      name: categoryId != null ? (nameById.get(categoryId) ?? "No category") : "No category",
      colorHex: categoryId != null ? (colorById.get(categoryId) ?? null) : null,
      count: entry.count,
      totalUsd: Math.round(entry.totalUsd * 100) / 100,
      // The share is the unrounded fraction, so the bars always add up to the full width.
      share: entry.totalUsd / total,
    }))
    .toSorted((a, b) => b.totalUsd - a.totalUsd);
}
