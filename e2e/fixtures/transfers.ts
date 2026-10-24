import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { readReplicaOwnerUserId } from "./indexed-db";
import type {
  Mutation,
  MutationFor,
  PushConflict,
  SyncedTransaction,
} from "../../src/modules/sync/sync-types";
import type { Page } from "@playwright/test";

export type WireTransaction = Omit<SyncedTransaction, "createdAt" | "updatedAt" | "deletedAt"> & {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
export type TransferUpsert = Extract<MutationFor<"transactions">, { op: "upsert" }>;
export type PushResult = {
  applied: string[];
  canonicalRows: {
    spheres: Array<{
      id: string;
      profileId: string;
      name: string;
      type: string;
      deletedAt: string | null;
    }>;
    allocations: Array<{
      id: string;
      profileId: string;
      sphereId: string;
      transactionId: string | null;
      openingAccountId: string | null;
      amount: string;
      currencyCode: string;
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
    }>;
    transactions: WireTransaction[];
    accounts: Array<{ id: string; currencyCode: string; deletedAt: string | null }>;
  };
  conflicts: PushConflict[];
};

export function asOperation<T extends Mutation>(mutations: T[]): T[] {
  const operation = {
    id: randomUUID(),
    mutationIds: mutations.map((mutation) => mutation.mutationId),
  };
  return mutations.map((mutation) => ({ ...mutation, operation }));
}

export async function pushMutations(page: Page, mutations: Mutation[]) {
  const ownerUserId = await readReplicaOwnerUserId(page);
  return page.evaluate(
    async ({ expectedOwnerUserId, mutations }) => {
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocolVersion: 3, expectedOwnerUserId, mutations }),
      });
      const text = await response.text();
      let body: PushResult;
      try {
        body = JSON.parse(text) as PushResult;
      } catch {
        body = { error: text } as unknown as PushResult;
      }
      return { status: response.status, body };
    },
    { expectedOwnerUserId: ownerUserId, mutations },
  );
}

export async function seedTransferAccounts(page: Page, currency: "USD" | "EUR" = "USD") {
  const profileId = randomUUID();
  const otherProfileId = randomUUID();
  const accounts = [randomUUID(), randomUUID(), randomUUID()];
  const result = await pushMutations(page, [
    ...[profileId, otherProfileId].map(
      (rowId): Mutation => ({
        mutationId: randomUUID(),
        rowId,
        table: "profiles",
        op: "upsert",
        baseUpdatedAt: null,
        payload: { name: "Transfer test profile" },
      }),
    ),
    ...accounts.map(
      (rowId, index): Mutation => ({
        mutationId: randomUUID(),
        rowId,
        table: "accounts",
        op: "upsert",
        baseUpdatedAt: null,
        payload: {
          name: `Transfer account ${index}`,
          initialBalance: "100.00",
          currencyCode: index === 1 ? currency : "USD",
          status: "ACTIVE",
          type: "CURRENT",
          profileId: index === 2 ? otherProfileId : profileId,
        },
      }),
    ),
  ]);
  expect(result.status).toBe(200);
  expect(
    result.body.canonicalRows.spheres
      .map((row) => ({ id: row.id, profileId: row.profileId, name: row.name, type: row.type }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  ).toEqual(
    [profileId, otherProfileId]
      .toSorted()
      .map((id) => ({ id, profileId: id, name: "Operating", type: "OPERATING" })),
  );
  expect(result.body.canonicalRows.allocations).toHaveLength(3);
  expect(
    result.body.canonicalRows.allocations.every(
      (row) =>
        row.amount === "100.00" &&
        row.transactionId === null &&
        row.sphereId === row.profileId &&
        row.deletedAt === null,
    ),
  ).toBe(true);
  return { profileId, otherProfileId, accounts };
}

export function transferMutations(
  profileId: string,
  accounts: string[],
  amounts = ["-10.00", "10.00"],
  existing?: WireTransaction[],
): TransferUpsert[] {
  const transferId = existing?.[0].transferId ?? randomUUID();
  return asOperation(
    amounts.map(
      (amount, index): TransferUpsert => ({
        mutationId: randomUUID(),
        rowId: existing?.[index].id ?? randomUUID(),
        table: "transactions",
        op: "upsert",
        baseUpdatedAt: existing ? Date.parse(existing[index].updatedAt) : null,
        payload: {
          profileId,
          transferId,
          accountId: accounts[index],
          type: "TRANSFER",
          amount,
          createdAt: new Date("2026-01-01T12:00:00Z"),
          categoryId: null,
          necessityLevel: "MEDIUM",
          comment: "Transfer protocol test",
        },
      }),
    ),
  );
}

export function canonicalLegs(
  result: PushResult,
  mutations: Pick<TransferUpsert, "rowId">[],
): WireTransaction[] {
  return mutations.map((mutation) => {
    const row = result.canonicalRows.transactions.find((row) => row.id === mutation.rowId);
    if (!row) throw new Error("The accepted transfer omitted a canonical leg.");
    return row;
  });
}

export function deleteTransfer(rows: WireTransaction[]): MutationFor<"transactions">[] {
  return asOperation(
    rows.map(
      (row): MutationFor<"transactions"> => ({
        mutationId: randomUUID(),
        rowId: row.id,
        table: "transactions",
        op: "delete",
        baseUpdatedAt: Date.parse(row.updatedAt),
      }),
    ),
  );
}

export async function readFinancialReplica(page: Page): Promise<{
  spheres: PushResult["canonicalRows"]["spheres"];
  allocations: PushResult["canonicalRows"]["allocations"];
  transactions: WireTransaction[];
  accounts: Array<{
    id: string;
    profileId: string;
    name: string;
    currencyCode: string;
    initialBalance: string;
    status: string;
  }>;
  outbox: Array<Mutation & { seq: number }>;
}> {
  return page.evaluate(async () => {
    const open = indexedDB.open("transactions-tracker");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const tx = db.transaction(
        ["transactions", "accounts", "outbox", "spheres", "allocations"],
        "readonly",
      );
      const values = await Promise.all(
        ["transactions", "accounts", "outbox", "spheres", "allocations"].map(
          (table) =>
            new Promise<unknown[]>((resolve, reject) => {
              const request = tx.objectStore(table).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
      return JSON.parse(
        JSON.stringify({
          transactions: values[0],
          accounts: values[1],
          outbox: values[2],
          spheres: values[3],
          allocations: values[4],
        }),
      );
    } finally {
      db.close();
    }
  });
}

/** The domain invariant compares independent account holdings and purpose records, per currency. */
export function expectOperatingReconciled(
  replica: Awaited<ReturnType<typeof readFinancialReplica>>,
) {
  const actual = new Map<string, number>();
  const allocated = new Map<string, number>();
  for (const account of replica.accounts) {
    const key = `${account.profileId}:${account.currencyCode}`;
    actual.set(key, (actual.get(key) ?? 0) + Math.round(Number(account.initialBalance) * 100));
    for (const transaction of replica.transactions.filter((row) => row.accountId === account.id)) {
      actual.set(key, actual.get(key)! + Math.round(Number(transaction.amount) * 100));
      expect(replica.allocations.find((row) => row.transactionId === transaction.id)).toMatchObject(
        {
          amount: transaction.amount,
          currencyCode: account.currencyCode,
          createdAt: transaction.createdAt,
          profileId: account.profileId,
          sphereId: account.profileId,
        },
      );
    }
  }
  for (const allocation of replica.allocations) {
    const key = `${allocation.profileId}:${allocation.currencyCode}`;
    allocated.set(key, (allocated.get(key) ?? 0) + Math.round(Number(allocation.amount) * 100));
  }
  expect(allocated).toEqual(actual);
  expect(new Set(replica.spheres.map((row) => row.profileId)).size).toBe(replica.spheres.length);
}
