import { expect, test } from "@playwright/test";
import type * as IdbModule from "../src/modules/sync/idb";

const DATABASE_NAME = "transactions-tracker";
const V2_STORES = ["profiles", "accounts", "categories", "transactions", "meta", "outbox"];

async function seedV2(
  page: import("@playwright/test").Page,
  seed: {
    profiles?: readonly object[];
    accounts?: readonly object[];
    categories?: readonly object[];
    transactions?: readonly object[];
    outbox?: readonly object[];
  },
): Promise<void> {
  // Establish the application origin without executing the app, which would open v3 before the
  // fixture can create a genuine v2 database.
  await page.goto("/sw.js");
  await page.evaluate(
    async ({ databaseName, stores, seedData }) => {
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(databaseName);
        deletion.addEventListener("success", () => resolve());
        deletion.addEventListener("error", () => reject(deletion.error));
      });

      const request = indexedDB.open(databaseName, 2);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.addEventListener("upgradeneeded", () => {
          for (const store of stores) {
            request.result.createObjectStore(
              store,
              store === "outbox"
                ? { keyPath: "seq", autoIncrement: true }
                : store === "meta"
                  ? undefined
                  : { keyPath: "id" },
            );
          }
        });
        request.addEventListener("success", () => resolve(request.result));
        request.addEventListener("error", () => reject(request.error));
      });

      const transaction = database.transaction(stores, "readwrite");
      for (const [store, values] of Object.entries(seedData)) {
        for (const value of values ?? []) transaction.objectStore(store).add(value);
      }
      transaction
        .objectStore("meta")
        .put({ profiles: { updatedAt: "cursor", id: null } }, "cursors");
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("abort", () => reject(transaction.error));
        transaction.addEventListener("error", () => reject(transaction.error));
      });
      database.close();
    },
    { databaseName: DATABASE_NAME, stores: V2_STORES, seedData: seed },
  );
}

test("v2 to v3 migration preserves rows, metadata, and the exact queued mutation", async ({
  page,
}) => {
  const queuedMutation = {
    mutationId: "019d0000-0000-7000-8000-000000000001",
    table: "accounts",
    op: "upsert",
    rowId: "account-a",
    baseUpdatedAt: 1_700_000_000_123,
    payload: { name: "Cash", profileId: "profile-a", initialBalance: "12.34" },
    createdAt: "legacy-extra-field-must-survive",
  };
  await seedV2(page, {
    profiles: [{ id: "profile-a", userId: 41, name: "A" }],
    accounts: [{ id: "account-a", profileId: "profile-a", name: "Cash" }],
    outbox: [queuedMutation],
  });

  const result = await page.evaluate(async () => {
    const load = new Function("return import('/src/modules/sync/idb.ts')") as () => Promise<
      typeof IdbModule
    >;
    const idb = await load();
    const snapshot = await idb.readLocalSnapshot();
    const database = await idb.openDatabase();
    const transaction = database.transaction(["outbox", "meta"], "readonly");
    const outboxRequest = transaction.objectStore("outbox").getAll();
    const cursorsRequest = transaction.objectStore("meta").get("cursors");
    const [outbox, cursors] = await Promise.all([
      new Promise<unknown[]>((resolve, reject) => {
        outboxRequest.addEventListener("success", () => resolve(outboxRequest.result));
        outboxRequest.addEventListener("error", () => reject(outboxRequest.error));
      }),
      new Promise<unknown>((resolve, reject) => {
        cursorsRequest.addEventListener("success", () => resolve(cursorsRequest.result));
        cursorsRequest.addEventListener("error", () => reject(cursorsRequest.error));
      }),
    ]);
    return { version: database.version, snapshot, outbox, cursors };
  });

  expect(result.version).toBe(3);
  expect(result.snapshot.descriptor.legacyOwnership).toEqual({
    kind: "candidate",
    ownerUserId: 41,
  });
  expect(result.snapshot.rows.profiles).toEqual([{ id: "profile-a", userId: 41, name: "A" }]);
  expect(result.cursors).toEqual({ profiles: { updatedAt: "cursor", id: null } });
  expect(result.outbox).toEqual([{ ...queuedMutation, seq: 1 }]);
});

for (const scenario of [
  {
    name: "empty",
    seed: {},
    expected: { kind: "unbound" },
  },
  {
    name: "mixed owners",
    seed: {
      profiles: [
        { id: "profile-a", userId: 41 },
        { id: "profile-b", userId: 42 },
      ],
    },
    expected: { kind: "recovery-required", reasons: ["mixed-profile-owners"] },
  },
  {
    name: "outbox only",
    seed: {
      outbox: [
        {
          mutationId: "019d0000-0000-7000-8000-000000000002",
          table: "accounts",
          op: "delete",
          rowId: "missing",
          baseUpdatedAt: null,
        },
      ],
    },
    expected: { kind: "recovery-required", reasons: ["missing-profile-owner"] },
  },
] as const) {
  test(`classifies a ${scenario.name} v2 replica without deleting it`, async ({ page }) => {
    await seedV2(page, scenario.seed);

    const result = await page.evaluate(async () => {
      const load = new Function("return import('/src/modules/sync/idb.ts')") as () => Promise<
        typeof IdbModule
      >;
      const snapshot = await (await load()).readLocalSnapshot();
      return { descriptor: snapshot.descriptor, outboxCount: snapshot.outbox.count };
    });

    expect(result.descriptor.legacyOwnership).toEqual(scenario.expected);
    expect(result.outboxCount).toBe(scenario.seed.outbox?.length ?? 0);
  });
}

test("a legacy owner candidate binds only after same-owner confirmation", async ({ page }) => {
  await seedV2(page, {
    profiles: [{ id: "profile-a", userId: 41, name: "A" }],
  });

  const result = await page.evaluate(async () => {
    const load = new Function("return import('/src/modules/sync/idb.ts')") as () => Promise<
      typeof IdbModule
    >;
    const idb = await load();
    const context = await idb.captureReplicaContext();
    const beforeBinding = await idb.captureSyncContext().then(
      () => "allowed",
      (error: Error) => error.name,
    );
    await idb.bindReplicaIdentity(context, { ownerUserId: 41, username: "alice" });
    const syncContext = await idb.captureSyncContext();
    const crossOwnerRebind = await idb
      .bindReplicaIdentity(syncContext, { ownerUserId: 42, username: "bob" })
      .then(
        () => "allowed",
        (error: Error) => error.name,
      );
    const descriptor = await idb.readReplicaDescriptor();
    return { beforeBinding, syncContext, crossOwnerRebind, descriptor };
  });

  expect(result.beforeBinding).toBe("ReplicaIdentityRequiredError");
  expect(result.syncContext).toEqual({
    ownerUserId: 41,
    replicaId: result.descriptor.replicaId,
  });
  expect(result.crossOwnerRebind).toBe("ReplicaContextChangedError");
  expect(result.descriptor.identity).toEqual({
    ownerUserId: 41,
    replicaId: result.descriptor.replicaId,
    username: "alice",
  });
  expect(result.descriptor.legacyOwnership).toEqual({ kind: "migrated" });
});

test("an A to B to A replacement rejects the old A incarnation", async ({ page }) => {
  await seedV2(page, {
    profiles: [{ id: "profile-a", userId: 41, name: "A" }],
  });

  const result = await page.evaluate(async () => {
    const load = new Function("return import('/src/modules/sync/idb.ts')") as () => Promise<
      typeof IdbModule
    >;
    const idb = await load();
    const legacyA = await idb.captureReplicaContext();
    await idb.bindReplicaIdentity(legacyA, { ownerUserId: 41, username: "alice" });
    const oldA = await idb.captureReplicaContext();

    const unboundB = await idb.replaceLocalReplica(oldA);
    await idb.bindReplicaIdentity(unboundB, { ownerUserId: 42, username: "bob" });
    const boundB = await idb.captureReplicaContext();
    const unboundA = await idb.replaceLocalReplica(boundB);
    await idb.bindReplicaIdentity(unboundA, { ownerUserId: 41, username: "alice" });
    const currentA = await idb.captureReplicaContext();

    const staleResult = await idb.writeLocalMutations(oldA, {}, []).then(
      () => "committed",
      (error: Error) => error.name,
    );
    return { oldA, currentA, staleResult };
  });

  expect(result.currentA.ownerUserId).toBe(result.oldA.ownerUserId);
  expect(result.currentA.replicaId).not.toBe(result.oldA.replicaId);
  expect(result.staleResult).toBe("ReplicaContextChangedError");
});

test("a failed local transaction changes neither rows nor localRevision", async ({ page }) => {
  await seedV2(page, {});

  const result = await page.evaluate(async () => {
    const load = new Function("return import('/src/modules/sync/idb.ts')") as () => Promise<
      typeof IdbModule
    >;
    const idb = await load();
    const context = await idb.captureReplicaContext();
    const failure = await idb
      .writeLocalMutations(context, { accounts: [{ name: "missing-key" }] } as never, [])
      .then(
        () => "committed",
        (error: Error) => error.name,
      );
    const snapshot = await idb.readLocalSnapshot();
    return {
      failure,
      accounts: snapshot.rows.accounts,
      localRevision: snapshot.localRevision,
      outboxCount: snapshot.outbox.count,
    };
  });

  expect(result.failure).not.toBe("committed");
  expect(result.accounts).toEqual([]);
  expect(result.localRevision).toBe(0);
  expect(result.outboxCount).toBe(0);
});

test("a blocked v3 upgrade rejects, then the cached open can be retried", async ({ page }) => {
  await seedV2(page, {});

  const result = await page.evaluate(async () => {
    const blockerRequest = indexedDB.open("transactions-tracker", 2);
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      blockerRequest.addEventListener("success", () => resolve(blockerRequest.result));
      blockerRequest.addEventListener("error", () => reject(blockerRequest.error));
    });
    blocker.addEventListener("versionchange", (event) => event.preventDefault());

    const load = new Function("return import('/src/modules/sync/idb.ts')") as () => Promise<
      typeof IdbModule
    >;
    const idb = await load();
    const first = await idb.openDatabase().then(
      () => "opened",
      (error: Error) => error.message,
    );
    blocker.close();
    const retried = await idb.openDatabase();
    return { first, version: retried.version };
  });

  expect(result.first).toContain("blocked");
  expect(result.version).toBe(3);
});
