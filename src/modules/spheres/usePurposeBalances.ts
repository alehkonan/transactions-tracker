import { useMemo } from "react";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { operatingBalances } from "./operating";

export function usePurposeBalances() {
  const profileId = useSelectedProfileId();
  const { accounts, transactions, allocations, isHydrated, pending } = useSyncStore();
  const complete =
    isHydrated &&
    !pending.some((table) =>
      ["accounts", "transactions", "spheres", "allocations"].includes(table),
    );
  const operating = useMemo(
    () => operatingBalances(profileId ?? "", { accounts, transactions, allocations }, complete),
    [profileId, accounts, transactions, allocations, complete],
  );
  return { complete, operating };
}
