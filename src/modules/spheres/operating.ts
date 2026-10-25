import { SYNCED_TABLES } from "~/modules/sync/synced-tables";
import { sumMoney } from "~/utils/money";
import type {
  SyncedAllocation,
  SyncedRows,
  SyncedTable,
  SyncedRow,
} from "~/modules/sync/sync-types";

/** Namespaced, deterministic UUIDv8, shared with financial_allocation_id in the migration. */
export async function allocationId(
  kind: "transaction" | "opening",
  sourceId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${kind}:${sourceId}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Materialized companions, written atomically beside their sources, never separate queued intents. */
export async function operatingRows(
  sources: Partial<SyncedRows>,
  accounts: SyncedRows["accounts"],
  existing: Partial<Pick<SyncedRows, "spheres" | "allocations">> = {},
): Promise<Pick<SyncedRows, "spheres" | "allocations">> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const existingAllocations = new Map((existing.allocations ?? []).map((row) => [row.id, row]));
  for (const account of sources.accounts ?? []) byId.set(account.id, account);
  const allocations = await Promise.all([
    ...(sources.accounts ?? [])
      .filter((row) => row.profileId != null)
      .map(
        async (account): Promise<SyncedAllocation> => ({
          id: await allocationId("opening", account.id),
          profileId: account.profileId!,
          sphereId: account.profileId!,
          transactionId: null,
          openingAccountId: account.id,
          amount: account.initialBalance,
          currencyCode: account.currencyCode,
          // Opening amounts have no transaction event date. Keep their attribution at a fixed epoch.
          createdAt: new Date(0),
          updatedAt: account.updatedAt,
          deletedAt: account.deletedAt,
        }),
      ),
    ...(sources.transactions ?? []).map(async (transaction): Promise<SyncedAllocation> => {
      const account = transaction.accountId == null ? undefined : byId.get(transaction.accountId);
      if (!account || account.profileId !== transaction.profileId) {
        throw new Error(
          "Cannot attribute a transaction without its account and currency. Recover the local replica first.",
        );
      }
      return {
        id: await allocationId("transaction", transaction.id),
        profileId: transaction.profileId,
        sphereId: transaction.profileId,
        transactionId: transaction.id,
        openingAccountId: null,
        amount: transaction.amount,
        currencyCode: account.currencyCode,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        deletedAt: transaction.deletedAt,
      };
    }),
  ]);
  const spheres: SyncedRows["spheres"] = [...(sources.spheres ?? [])];
  for (const profile of sources.profiles ?? []) {
    spheres.push({
      id: profile.id,
      profileId: profile.id,
      name: "Operating",
      type: "OPERATING" as const,
      archived: false,
      hasHistory: existing.spheres?.find((row) => row.id === profile.id)?.hasHistory ?? false,
      updatedAt: profile.updatedAt,
      deletedAt: profile.deletedAt,
    });
    if (profile.deletedAt != null) {
      for (const sphere of existing.spheres ?? []) {
        if (sphere.profileId === profile.id && sphere.id !== profile.id)
          spheres.push({ ...sphere, deletedAt: profile.deletedAt, updatedAt: profile.updatedAt });
      }
    }
  }
  return {
    spheres,
    allocations: [
      ...(sources.allocations ?? []),
      ...allocations.map((row) => ({
        ...row,
        sphereId: existingAllocations.get(row.id)?.sphereId ?? row.sphereId,
      })),
      ...(sources.profiles ?? []).flatMap((profile) =>
        profile.deletedAt == null
          ? []
          : (existing.allocations ?? [])
              .filter((row) => row.profileId === profile.id && row.reallocationId)
              .map((row) => ({
                ...row,
                deletedAt: profile.deletedAt,
                updatedAt: profile.updatedAt,
              })),
      ),
    ],
  };
}

/** Companions yield to the same immutable source intent during pull and settlement. */
export function hasPendingSource(
  table: SyncedTable,
  row: SyncedRow,
  keys: ReadonlySet<string>,
): boolean {
  if (keys.has(`${table}:${row.id}`)) return true;
  if (table === "spheres" && "profileId" in row) return keys.has(`profiles:${row.profileId}`);
  if (table === "allocations" && "transactionId" in row && "openingAccountId" in row) {
    return row.transactionId != null
      ? keys.has(`transactions:${row.transactionId}`)
      : keys.has(`accounts:${row.openingAccountId}`);
  }
  return false;
}

export function pendingParentDeletes(
  entries: readonly { table: string; op: string; rowId: string }[],
): Set<string> {
  return new Set(
    entries
      .filter(
        (entry) =>
          entry.op === "delete" && (entry.table === "profiles" || entry.table === "accounts"),
      )
      .map((entry) => `${entry.table}:${entry.rowId}`),
  );
}

/** An earlier acceptance must not undo a newer local cascade while its parent delete is queued. */
export function filterPendingCascades(
  rows: Partial<SyncedRows>,
  deletedParents: ReadonlySet<string>,
): Partial<SyncedRows> {
  if (deletedParents.size === 0) return rows;
  const deletedTransfers = new Set(
    (rows.transactions ?? [])
      .filter((row) => row.accountId != null && deletedParents.has(`accounts:${row.accountId}`))
      .flatMap((row) => row.transferId ?? []),
  );
  const deletedTransactions = new Set(
    (rows.transactions ?? [])
      .filter(
        (row) =>
          deletedParents.has(`profiles:${row.profileId}`) ||
          deletedParents.has(`accounts:${row.accountId}`) ||
          (row.transferId != null && deletedTransfers.has(row.transferId)),
      )
      .map((row) => row.id),
  );
  return Object.fromEntries(
    SYNCED_TABLES.map((table) => [
      table,
      (rows[table] ?? []).filter((row) => {
        if (table === "profiles") return !deletedParents.has(`profiles:${row.id}`);
        if ("profileId" in row && deletedParents.has(`profiles:${row.profileId}`)) return false;
        if (table === "accounts") return !deletedParents.has(`accounts:${row.id}`);
        if (table === "transactions") return !deletedTransactions.has(row.id);
        if ("openingAccountId" in row)
          return (
            !deletedParents.has(`accounts:${row.openingAccountId}`) &&
            !deletedTransactions.has(row.transactionId ?? "")
          );
        return true;
      }),
    ]),
  ) as Partial<SyncedRows>;
}

function addAmount(map: Map<string, string[]>, currency: string, amount: string): void {
  const amounts = map.get(currency);
  if (amounts) amounts.push(amount);
  else map.set(currency, [amount]);
}

/** No exchange-rate rounding: reconciliation is always exact within each currency. */
export function operatingBalances(
  profileId: string,
  rows: Pick<SyncedRows, "accounts" | "transactions" | "allocations">,
  complete: boolean,
) {
  const ownedAccounts = rows.accounts.filter(
    (row) => row.profileId === profileId && row.deletedAt == null,
  );
  const byAccount = new Map(ownedAccounts.map((row) => [row.id, row]));
  const actual = new Map<string, string[]>();
  const allocated = new Map<string, string[]>();
  const allSpheres = new Map<string, string[]>();
  for (const account of ownedAccounts)
    addAmount(actual, account.currencyCode, account.initialBalance);
  for (const transaction of rows.transactions) {
    const account =
      transaction.accountId == null ? undefined : byAccount.get(transaction.accountId);
    if (account && transaction.profileId === profileId && transaction.deletedAt == null)
      addAmount(actual, account.currencyCode, transaction.amount);
  }
  for (const allocation of rows.allocations) {
    if (allocation.profileId === profileId && allocation.deletedAt == null)
      addAmount(allSpheres, allocation.currencyCode, allocation.amount);
    if (
      allocation.profileId === profileId &&
      allocation.sphereId === profileId &&
      allocation.deletedAt == null
    )
      addAmount(allocated, allocation.currencyCode, allocation.amount);
  }
  return [...new Set([...actual.keys(), ...allSpheres.keys()])].toSorted().map((currencyCode) => {
    const accountBalance = sumMoney(actual.get(currencyCode) ?? []);
    const sphereBalance = sumMoney(allocated.get(currencyCode) ?? []);
    return {
      currencyCode,
      accountBalance,
      sphereBalance,
      status: !complete
        ? ("incomplete" as const)
        : accountBalance === sumMoney(allSpheres.get(currencyCode) ?? [])
          ? ("reconciled" as const)
          : ("diverged" as const),
    };
  });
}
