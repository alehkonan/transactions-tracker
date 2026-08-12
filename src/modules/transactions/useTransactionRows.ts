import { useMemo } from "react";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { useCategories } from "~/modules/categories/useCategories";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { toTransactionRows } from "~/modules/transactions/to-transaction-rows";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

/**
 * Every transaction of the selected profile, newest first, resolved against its account and
 * category — what the old `getTransactions` query returned, minus the query.
 *
 * Unfiltered on purpose: the table's own date/account filters run over this (see
 * `filterTransactions`), so changing one is a re-render rather than a round trip.
 */
export function useTransactionRows(): TransactionRow[] {
  const profileId = readSelectedProfileId();
  const transactions = useSyncStore((state) => state.transactions);
  const usdRates = useSyncStore((state) => state.usdRates);
  const accounts = useAccounts();
  const categories = useCategories();

  return useMemo(() => {
    if (profileId == null) return [];

    return toTransactionRows({
      transactions: transactions.filter((transaction) => transaction.profileId === profileId),
      accounts,
      categories,
      usdRates,
    });
  }, [transactions, accounts, categories, usdRates, profileId]);
}
