import { expect, test } from "@playwright/test";
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  readReplicaDescriptor,
  waitForDatabaseVersion,
  type ReplicaDescriptor,
} from "../fixtures/indexed-db";
import type { Download, Page } from "@playwright/test";

test.use({ acceptDownloads: true });

const V2_STORES = ["profiles", "accounts", "categories", "transactions", "meta", "outbox"];

type V2Seed = {
  profiles?: readonly object[];
  accounts?: readonly object[];
  categories?: readonly object[];
  transactions?: readonly object[];
  outbox?: readonly object[];
};

type RawSnapshot = {
  version: number;
  descriptor: ReplicaDescriptor;
  profiles: unknown[];
  outbox: unknown[];
  cursors: unknown;
  localRevision: number;
};

async function seedV2(page: Page, seed: V2Seed): Promise<void> {
  // Establish the application origin without loading the app, which would upgrade the database first.
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

async function openAppAndReadMigratedSnapshot(page: Page): Promise<RawSnapshot> {
  await page.goto("/transactions");
  await waitForDatabaseVersion(page);

  return page.evaluate(async (databaseName) => {
    const openRequest = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.addEventListener("success", () => resolve(openRequest.result));
      openRequest.addEventListener("error", () => reject(openRequest.error));
    });

    try {
      const transaction = database.transaction(["profiles", "outbox", "meta"], "readonly");
      const profilesRequest = transaction.objectStore("profiles").getAll();
      const outboxRequest = transaction.objectStore("outbox").getAll();
      const meta = transaction.objectStore("meta");
      const descriptorRequest = meta.get("replicaDescriptor");
      const cursorsRequest = meta.get("cursors");
      const localRevisionRequest = meta.get("localRevision");
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay inside page.evaluate.
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });
      const [profiles, outbox, descriptor, cursors, localRevision] = await Promise.all([
        read(profilesRequest),
        read(outboxRequest),
        read(descriptorRequest),
        read(cursorsRequest),
        read(localRevisionRequest),
      ]);

      return {
        version: database.version,
        descriptor,
        profiles,
        outbox,
        cursors,
        localRevision,
      } as RawSnapshot;
    } finally {
      database.close();
    }
  }, DATABASE_NAME);
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("The recovery download stream was unavailable.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

test("v2 to v3 migration preserves rows, metadata, and queued mutation order", async ({ page }) => {
  const queuedMutation = {
    mutationId: "019d0000-0000-7000-8000-000000000001",
    table: "accounts",
    op: "upsert",
    rowId: "account-a",
    baseUpdatedAt: 1_700_000_000_123,
    payload: { name: "Cash", profileId: "profile-a", initialBalance: "12.34" },
    createdAt: "legacy-extra-field-must-survive",
  };
  const secondQueuedMutation = {
    mutationId: "019d0000-0000-7000-8000-000000000002",
    table: "profiles",
    op: "upsert",
    rowId: "profile-a",
    baseUpdatedAt: 1_700_000_000_456,
    payload: { name: "Renamed A" },
  };
  await seedV2(page, {
    profiles: [{ id: "profile-a", userId: 41, name: "A" }],
    accounts: [{ id: "account-a", profileId: "profile-a", name: "Cash" }],
    outbox: [queuedMutation, secondQueuedMutation],
  });

  const snapshot = await openAppAndReadMigratedSnapshot(page);

  expect(snapshot.version).toBe(DATABASE_VERSION);
  expect(snapshot.descriptor.legacyOwnership).toEqual({ kind: "candidate", ownerUserId: 41 });
  expect(snapshot.profiles).toEqual([{ id: "profile-a", userId: 41, name: "A" }]);
  expect(snapshot.cursors).toEqual({ profiles: { updatedAt: "cursor", id: null } });
  expect(snapshot.localRevision).toBe(0);
  expect(snapshot.outbox).toEqual([
    { ...queuedMutation, seq: 1 },
    { ...secondQueuedMutation, seq: 2 },
  ]);
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
    expected: {
      kind: "recovery-required",
      reasons: ["missing-profile-owner", "inconsistent-references"],
    },
  },
] as const) {
  test(`classifies a ${scenario.name} v2 replica without deleting it`, async ({ page }) => {
    await seedV2(page, scenario.seed);

    const snapshot = await openAppAndReadMigratedSnapshot(page);

    expect(snapshot.descriptor.legacyOwnership).toEqual(scenario.expected);
    expect(snapshot.outbox).toHaveLength(scenario.seed.outbox?.length ?? 0);
  });
}

test("an ambiguous legacy replica exposes a complete recovery download and does not sync", async ({
  page,
}) => {
  await seedV2(page, {
    profiles: [
      { id: "profile-a", userId: 41, name: "A" },
      { id: "profile-b", userId: 42, name: "B" },
    ],
    outbox: [
      {
        mutationId: "019d0000-0000-7000-8000-000000000003",
        table: "profiles",
        op: "upsert",
        rowId: "profile-a",
        baseUpdatedAt: null,
        payload: { name: "A pending" },
      },
    ],
  });
  const syncRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/_serverFn/") || request.url().endsWith("/api/push")) {
      syncRequests.push(request.url());
    }
  });

  await page.goto("/transactions");
  await waitForDatabaseVersion(page);
  await expect(page.getByText("Local data needs recovery", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-local-recovery").click();
  const download = await downloadPromise;
  const recovery = JSON.parse(await downloadText(download)) as {
    formatVersion: number;
    database: { name: string; version: number };
    descriptor: ReplicaDescriptor;
    rows: { profiles: Array<{ id: string }> };
    outbox: unknown[];
  };

  expect(download.suggestedFilename()).toMatch(
    /^transactions-tracker-recovery-\d{4}-\d{2}-\d{2}\.json$/,
  );
  expect(recovery.formatVersion).toBe(1);
  expect(recovery.database).toEqual({ name: DATABASE_NAME, version: DATABASE_VERSION });
  expect(recovery.descriptor.legacyOwnership).toEqual({
    kind: "recovery-required",
    reasons: ["mixed-profile-owners"],
  });
  expect(recovery.rows.profiles.map((profile) => profile.id)).toEqual(["profile-a", "profile-b"]);
  expect(recovery.outbox).toHaveLength(1);
  expect(recovery).not.toHaveProperty("cookies");
  expect(recovery).not.toHaveProperty("credentials");
  expect(syncRequests).toEqual([]);
});

test("a blocked v3 upgrade reports an error and retries after the other tab closes", async ({
  context,
  page,
}) => {
  const blockerPage = await context.newPage();
  await seedV2(blockerPage, {});
  await blockerPage.evaluate(async (databaseName) => {
    const request = indexedDB.open(databaseName, 2);
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    blocker.addEventListener("versionchange", (event) => event.preventDefault());
    Reflect.set(window, "__e2eIdbBlocker", blocker);
  }, DATABASE_NAME);

  await page.goto("/transactions");
  await expect(page.getByText("Could not load your data", { exact: true })).toBeVisible();

  await blockerPage.evaluate(() => {
    const blocker = Reflect.get(window, "__e2eIdbBlocker") as IDBDatabase;
    blocker.close();
  });
  await page.getByRole("button", { name: "Try again", exact: true }).click();

  await waitForDatabaseVersion(page);
  await expect(page.getByText("Could not load your data", { exact: true })).not.toBeVisible();
  await expect(readReplicaDescriptor(page)).resolves.toMatchObject({
    lifecycle: "active",
    legacyOwnership: { kind: "unbound" },
  });
});
