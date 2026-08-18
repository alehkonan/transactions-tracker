import { useMemo } from "react";
import { toAccountsWithBalance } from "~/modules/accounts/compute-balances";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

/**
 * The selected profile's accounts, name-sorted, each with its balance derived from the transactions
 * in the store.
 *
 * The raw arrays are selected as-is — never mapped or filtered inside the selector — because a new
 * array on every render is a new snapshot to Zustand, and the derivation then re-runs forever.
 */
export function useAccounts(): AccountWithBalance[] {
  const profileId = readSelectedProfileId();
  const accounts = useSyncStore((state) => state.accounts);
  const transactions = useSyncStore((state) => state.transactions);

  return useMemo(() => {
    if (profileId == null) return [];

    return toAccountsWithBalance(
      accounts.filter((account) => account.profileId === profileId),
      transactions.filter((transaction) => transaction.profileId === profileId),
    ).toSorted((a, b) => a.name.localeCompare(b.name));
  }, [accounts, transactions, profileId]);
}
