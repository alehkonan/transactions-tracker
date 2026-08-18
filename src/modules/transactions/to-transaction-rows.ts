import { toUsd } from "~/utils/money";
import type { CategoryRow } from "~/modules/categories/to-category-rows";
import type { SyncedAccount, SyncedTransaction } from "~/modules/sync/sync-types";

/**
 * One row of the transactions table: the transaction plus the bits of its account and category the
 * table draws. What used to be a three-way `leftJoin` is a couple of Map lookups now.
 */
export type TransactionRow = {
  id: string;
  createdAt: Date;
  categoryId: string | null;
  category: string | null;
  categoryColorHex: string | null;
  necessityLevel: SyncedTransaction["necessityLevel"];
  type: SyncedTransaction["type"];
  accountId: string | null;
  account: string | null;
  amount: string;
  currencyCode: SyncedAccount["currencyCode"] | null;
  comment: string | null;
  /** The amount in USD, for rows in another currency. `null` when the account is unknown. */
  approxAmountUsd: string | null;
};

type Options = {
  transactions: SyncedTransaction[];
  accounts: SyncedAccount[];
  categories: CategoryRow[];
  usdRates: Record<string, number>;
};

/**
 * Resolves each transaction against its account and category, newest first.
 *
 * A row can outlive either: deleting a category leaves the transactions that used it pointing at a
 * row the client no longer holds, which reads as "no category" — the same as never having had one.
 */
export function toTransactionRows({
  transactions,
  accounts,
  categories,
  usdRates,
}: Options): TransactionRow[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const categoriesById = new Map(categories.map((category) => [category.id, category]));

  return transactions
    .map((transaction): TransactionRow => {
      const account =
        transaction.accountId != null ? accountsById.get(transaction.accountId) : undefined;
      const category =
        transaction.categoryId != null ? categoriesById.get(transaction.categoryId) : undefined;

      return {
        id: transaction.id,
        createdAt: transaction.createdAt,
        categoryId: transaction.categoryId,
        category: category?.name ?? null,
        categoryColorHex: category?.colorHex ?? null,
        necessityLevel: transaction.necessityLevel,
        type: transaction.type,
        accountId: transaction.accountId,
        account: account?.name ?? null,
        amount: transaction.amount,
        currencyCode: account?.currencyCode ?? null,
        comment: transaction.comment,
        approxAmountUsd:
          account != null
            ? toUsd(transaction.amount, account.currencyCode, usdRates).toFixed(2)
            : null,
      };
    })
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
