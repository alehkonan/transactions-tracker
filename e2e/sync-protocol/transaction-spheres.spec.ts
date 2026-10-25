import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "../fixtures/auth";
import {
  canonicalLegs,
  deleteTransfer,
  pushMutations,
  seedTransferAccounts,
  transferMutations,
} from "../fixtures/transfers";
import type { Mutation, MutationFor } from "../../src/modules/sync/sync-types";

function namedSphere(profileId: string, name: string, type: "FUNDS" | "CAPITAL") {
  return {
    mutationId: randomUUID(),
    rowId: randomUUID(),
    table: "spheres",
    op: "upsert",
    baseUpdatedAt: null,
    payload: { profileId, name, type, archived: false },
  } satisfies Mutation;
}

test("a pending transfer deletion settles without changing history archived on another device", async ({
  authenticatedPage: page,
}) => {
  const { profileId, accounts } = await seedTransferAccounts(page);
  const sphereId = randomUUID();
  const sphere = { profileId, name: "Travel", type: "FUNDS" as const, archived: false };
  const createdSphere = await pushMutations(page, [
    {
      mutationId: randomUUID(),
      rowId: sphereId,
      table: "spheres",
      op: "upsert",
      baseUpdatedAt: null,
      payload: sphere,
    },
  ]);
  expect(createdSphere.status).toBe(200);
  const pair = transferMutations(profileId, accounts).map((mutation) => ({
    ...mutation,
    payload: { ...mutation.payload, sphereId },
  }));
  const created = await pushMutations(page, pair);
  expect(created.status).toBe(200);
  expect(created.body.canonicalRows.allocations.map((row) => row.sphereId)).toEqual([
    sphereId,
    sphereId,
  ]);
  const pendingDelete = deleteTransfer(canonicalLegs(created.body, pair));
  const archived = await pushMutations(page, [
    {
      mutationId: randomUUID(),
      rowId: sphereId,
      table: "spheres",
      op: "upsert",
      baseUpdatedAt: null,
      payload: { ...sphere, archived: true },
    },
  ]);
  expect(archived.status).toBe(200);
  const legacyEdit = transferMutations(
    profileId,
    accounts,
    ["-20.00", "20.00"],
    canonicalLegs(created.body, pair),
  );
  const legacySettled = await pushMutations(page, legacyEdit);
  expect(legacySettled.status).toBe(200);
  expect(legacySettled.body.conflicts.map((row) => row.classification)).toEqual([
    "canonical-diverged",
    "canonical-diverged",
  ]);
  expect(legacySettled.body.canonicalRows.allocations).toEqual(
    created.body.canonicalRows.allocations,
  );
  const settled = await pushMutations(page, pendingDelete);
  expect(settled.status).toBe(200);
  expect(settled.body.applied).toEqual(pendingDelete.map((mutation) => mutation.mutationId));
  expect(settled.body.conflicts.map((row) => row.classification)).toEqual([
    "canonical-diverged",
    "canonical-diverged",
  ]);
  expect(settled.body.canonicalRows.transactions.every((row) => row.deletedAt === null)).toBe(true);
  expect(settled.body.canonicalRows.allocations).toEqual(created.body.canonicalRows.allocations);
  const replay = await pushMutations(page, pendingDelete);
  expect(replay.status).toBe(200);
  expect(replay.body.conflicts).toEqual(settled.body.conflicts);
});

test("selected purposes follow actual income and expenses through account, currency, date, sphere edits and deletion", async ({
  authenticatedPage: page,
}) => {
  const { profileId, accounts } = await seedTransferAccounts(page, "EUR");
  const funds = namedSphere(profileId, "Travel", "FUNDS");
  const capital = namedSphere(profileId, "Savings", "CAPITAL");
  const categoryId = randomUUID();
  expect(
    (
      await pushMutations(page, [
        funds,
        capital,
        {
          mutationId: randomUUID(),
          rowId: categoryId,
          table: "categories",
          op: "upsert",
          baseUpdatedAt: null,
          payload: { profileId, name: "Interest and refunds", colorId: null },
        },
      ])
    ).status,
  ).toBe(200);
  const income = {
    mutationId: randomUUID(),
    rowId: randomUUID(),
    table: "transactions",
    op: "upsert",
    baseUpdatedAt: null,
    payload: {
      profileId,
      accountId: accounts[0],
      type: "INCOME",
      amount: "50.00",
      sphereId: funds.rowId,
      createdAt: new Date("2026-01-01T12:00:00Z"),
      categoryId,
      necessityLevel: "MEDIUM",
      comment: "Interest",
    },
  } satisfies Extract<MutationFor<"transactions">, { op: "upsert" }>;
  const expense = {
    ...income,
    mutationId: randomUUID(),
    rowId: randomUUID(),
    payload: {
      ...income.payload,
      type: "EXPENSE" as const,
      amount: "-12.50",
      comment: "Travel expense",
    },
  };
  const created = await pushMutations(page, [income, expense]);
  expect(created.status).toBe(200);
  expect(created.body.canonicalRows.allocations).toHaveLength(2);
  expect(created.body.canonicalRows.allocations.map((row) => row.amount).toSorted()).toEqual([
    "-12.50",
    "50.00",
  ]);
  expect(
    created.body.canonicalRows.allocations.every(
      (row) => row.sphereId === funds.rowId && row.currencyCode === "USD",
    ),
  ).toBe(true);
  expect(
    created.body.canonicalRows.allocations.every(
      (row) => !("categoryId" in row) && !("type" in row),
    ),
  ).toBe(true);
  expect(
    created.body.canonicalRows.transactions.every((row) => row.categoryId === categoryId),
  ).toBe(true);
  const edited = {
    ...expense,
    mutationId: randomUUID(),
    baseUpdatedAt: Date.parse(
      created.body.canonicalRows.transactions.find((row) => row.id === expense.rowId)!.updatedAt,
    ),
    payload: {
      ...expense.payload,
      accountId: accounts[1],
      sphereId: capital.rowId,
      amount: "-9.25",
      createdAt: new Date("2026-02-03T10:30:00Z"),
    },
  };
  const changed = await pushMutations(page, [edited]);
  expect(changed.status).toBe(200);
  expect(changed.body.canonicalRows.transactions[0]).toMatchObject({
    id: expense.rowId,
    accountId: accounts[1],
    amount: "-9.25",
    categoryId,
    createdAt: "2026-02-03T10:30:00.000Z",
  });
  expect(changed.body.canonicalRows.allocations[0]).toMatchObject({
    transactionId: expense.rowId,
    sphereId: capital.rowId,
    currencyCode: "EUR",
    amount: "-9.25",
    createdAt: "2026-02-03T10:30:00.000Z",
  });
  // Queued clients predating sphere choice must retain the current attribution and receipt shape.
  const { sphereId: _sphereId, ...legacyPayload } = edited.payload;
  const legacy = {
    ...edited,
    mutationId: randomUUID(),
    payload: { ...legacyPayload, amount: "-10.00" },
  };
  const legacyEdit = await pushMutations(page, [legacy]);
  expect(legacyEdit.status).toBe(200);
  expect(legacyEdit.body.canonicalRows.allocations[0]).toMatchObject({
    sphereId: capital.rowId,
    amount: "-10.00",
    currencyCode: "EUR",
  });
  const deletion = {
    mutationId: randomUUID(),
    rowId: expense.rowId,
    table: "transactions" as const,
    op: "delete" as const,
    baseUpdatedAt: null,
  };
  const deleted = await pushMutations(page, [deletion]);
  expect(deleted.status).toBe(200);
  expect(deleted.body.canonicalRows.allocations[0].deletedAt).not.toBeNull();
  expect(deleted.body.canonicalRows.transactions[0].deletedAt).not.toBeNull();
  expect((await pushMutations(page, [income])).body.canonicalRows.allocations[0]).toEqual(
    created.body.canonicalRows.allocations.find((row) => row.transactionId === income.rowId),
  );
  expect((await pushMutations(page, [deletion])).body.conflicts).toEqual(deleted.body.conflicts);
});

test("cross-currency purposes are independent, profile-scoped, and bound to immutable receipt identities", async ({
  authenticatedPage: page,
}) => {
  const { profileId, otherProfileId, accounts } = await seedTransferAccounts(page, "EUR");
  const funds = namedSphere(profileId, "Travel", "FUNDS");
  const capital = namedSphere(profileId, "Savings", "CAPITAL");
  const foreign = namedSphere(otherProfileId, "Other profile reserve", "FUNDS");
  expect((await pushMutations(page, [funds, capital, foreign])).status).toBe(200);
  const pair = transferMutations(profileId, accounts, ["-20.00", "18.50"]).map(
    (mutation, index) => ({
      ...mutation,
      payload: { ...mutation.payload, sphereId: index === 0 ? foreign.rowId : capital.rowId },
    }),
  );
  expect((await pushMutations(page, pair)).status).toBe(403);
  const corrected = pair.map((mutation, index) => ({
    ...mutation,
    payload: { ...mutation.payload, sphereId: index === 0 ? funds.rowId : capital.rowId },
  }));
  const accepted = await pushMutations(page, corrected);
  expect(accepted.status).toBe(200); // Authorization failure left no receipt or partial source leg.
  expect(accepted.body.canonicalRows.allocations).toHaveLength(2);
  expect(
    accepted.body.canonicalRows.allocations.find((row) => row.transactionId === corrected[0].rowId),
  ).toMatchObject({ sphereId: funds.rowId, currencyCode: "USD", amount: "-20.00" });
  expect(
    accepted.body.canonicalRows.allocations.find((row) => row.transactionId === corrected[1].rowId),
  ).toMatchObject({ sphereId: capital.rowId, currencyCode: "EUR", amount: "18.50" });
  expect((await pushMutations(page, corrected)).body.canonicalRows.allocations).toEqual(
    accepted.body.canonicalRows.allocations,
  );
  const changedIntent = corrected.map((mutation) => ({
    ...mutation,
    payload: { ...mutation.payload, sphereId: profileId },
  }));
  expect((await pushMutations(page, changedIntent)).status).toBe(409);
});

test("an offline transfer to a newly archived sphere settles as a complete rejection and replays without duplication", async ({
  authenticatedPage: page,
}) => {
  const { profileId, accounts } = await seedTransferAccounts(page);
  const sphere = namedSphere(profileId, "Travel", "FUNDS");
  expect((await pushMutations(page, [sphere])).status).toBe(200);
  const pending = transferMutations(profileId, accounts).map((mutation, index) => ({
    ...mutation,
    payload: { ...mutation.payload, sphereId: index === 0 ? sphere.rowId : profileId },
  }));
  expect(
    (
      await pushMutations(page, [
        { ...sphere, mutationId: randomUUID(), payload: { ...sphere.payload, archived: true } },
      ])
    ).status,
  ).toBe(200);
  const rejected = await pushMutations(page, pending);
  expect(rejected.status).toBe(200);
  expect(rejected.body.applied).toEqual(pending.map((mutation) => mutation.mutationId));
  expect(rejected.body.conflicts.map((row) => row.classification)).toEqual([
    "canonical-deleted",
    "canonical-deleted",
  ]);
  expect(rejected.body.canonicalRows.transactions).toHaveLength(2);
  expect(rejected.body.canonicalRows.transactions.every((row) => row.deletedAt != null)).toBe(true);
  expect(rejected.body.canonicalRows.allocations).toHaveLength(2);
  expect(rejected.body.canonicalRows.allocations.every((row) => row.deletedAt != null)).toBe(true);
  const replay = await pushMutations(page, pending);
  expect(replay.status).toBe(200);
  expect(replay.body.conflicts).toEqual(rejected.body.conflicts);
  expect(replay.body.canonicalRows.allocations).toEqual(rejected.body.canonicalRows.allocations);
});
