import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "../fixtures/auth";
import {
  asOperation,
  canonicalLegs,
  deleteTransfer,
  linkExistingTransfers,
  pushMutations,
  seedTransferAccounts,
  transferMutations,
} from "../fixtures/transfers";

for (const currency of ["USD", "EUR"] as const) {
  test(`manual linking preserves ${currency} history and sphere attribution through replay and the whole-transfer lifecycle`, async ({
    authenticatedPage: page,
  }) => {
    const { profileId, otherProfileId, accounts } = await seedTransferAccounts(page, currency);
    const categoryId = randomUUID();
    const sphereId = randomUUID();
    expect(
      (
        await pushMutations(page, [
          {
            mutationId: randomUUID(),
            rowId: categoryId,
            table: "categories",
            op: "upsert",
            baseUpdatedAt: null,
            payload: { name: "Saved category", profileId, colorId: null },
          },
          {
            mutationId: randomUUID(),
            rowId: sphereId,
            table: "spheres",
            op: "upsert",
            baseUpdatedAt: null,
            payload: { name: "Saved reserve", profileId, type: "FUNDS", archived: false },
          },
        ])
      ).status,
    ).toBe(200);
    const legacy = transferMutations(profileId, accounts, [
      "-10.00",
      currency === "EUR" ? "9.25" : "10.00",
    ]).map(
      (
        { operation: _operation, payload: { transferId: _transferId, ...payload }, ...mutation },
        index,
      ) => ({
        ...mutation,
        payload: {
          ...payload,
          categoryId,
          sphereId: index === 0 ? sphereId : profileId,
          createdAt: new Date(`2026-01-0${index + 1}T12:00:00Z`),
          comment: `Saved leg ${index}`,
        },
      }),
    );
    const created = await pushMutations(page, legacy);
    expect(created.status).toBe(200);
    const original = canonicalLegs(created.body, legacy);
    expect(original.every((row) => row.transferId == null)).toBe(true);
    const link = linkExistingTransfers(original);
    const changedHistory = link.map((mutation, index) => ({
      ...mutation,
      payload: { ...mutation.payload, amount: index === 0 ? "-20.00" : "20.00" },
    }));
    expect((await pushMutations(page, changedHistory)).status).toBe(400);

    // Both profiles are owned, but they cannot participate in one transfer.
    const otherLegacy = transferMutations(otherProfileId, [accounts[2], accounts[2]])
      .slice(0, 1)
      .map(
        ({
          operation: _operation,
          payload: { transferId: _transferId, ...payload },
          ...mutation
        }) => ({ ...mutation, payload: { ...payload, amount: "10.00" } }),
      );
    const other = await pushMutations(page, otherLegacy);
    expect(other.status).toBe(200);
    expect(
      (
        await pushMutations(
          page,
          linkExistingTransfers([original[0], other.body.canonicalRows.transactions[0]]),
        )
      ).status,
    ).toBe(400);

    const linked = await pushMutations(page, link);
    expect(linked.status).toBe(200); // The rejected attempt did not consume receipt identities.
    const pair = canonicalLegs(linked.body, link);
    for (const [index, row] of pair.entries()) {
      const { updatedAt: _updatedAt, transferId: _transferId, ...saved } = original[index];
      expect(row).toMatchObject({ ...saved, transferId: link[0].payload.transferId });
    }
    expect(
      linked.body.canonicalRows.allocations
        .map(({ updatedAt: _updatedAt, ...row }) => row)
        .toSorted((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(
      created.body.canonicalRows.allocations
        .map(({ updatedAt: _updatedAt, ...row }) => row)
        .toSorted((a, b) => a.id.localeCompare(b.id)),
    );
    const replay = await pushMutations(page, link);
    expect(replay.status).toBe(200);
    expect(replay.body.applied).toEqual(linked.body.applied);
    expect(canonicalLegs(replay.body, link)).toEqual(pair);
    expect((await pushMutations(page, linkExistingTransfers(pair))).status).toBe(400);

    const edit = transferMutations(
      profileId,
      accounts,
      ["-20.00", currency === "EUR" ? "18.50" : "20.00"],
      pair,
    );
    const edited = await pushMutations(page, edit);
    expect(edited.status).toBe(200);
    expect(edited.body.canonicalRows.allocations.map((row) => row.amount).toSorted()).toEqual(
      currency === "EUR" ? ["-20.00", "18.50"] : ["-20.00", "20.00"],
    );
    const deleted = await pushMutations(
      page,
      deleteTransfer(canonicalLegs(edited.body, edit).toReversed()),
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.canonicalRows.transactions).toHaveLength(2);
    expect(deleted.body.canonicalRows.transactions.every((row) => row.deletedAt != null)).toBe(
      true,
    );
    expect(deleted.body.canonicalRows.allocations).toHaveLength(2);
    expect(deleted.body.canonicalRows.allocations.every((row) => row.deletedAt != null)).toBe(true);
  });
}

test("linked transfer creation, stale edits, deletion, and lost-response replays retain complete immutable outcomes", async ({
  authenticatedPage: page,
}) => {
  const { profileId, accounts } = await seedTransferAccounts(page);
  const create = transferMutations(profileId, accounts);
  const created = await pushMutations(page, create);
  expect(created.status).toBe(200);
  const initial = canonicalLegs(created.body, create);
  expect(initial.map((row) => row.amount)).toEqual(["-10.00", "10.00"]);
  expect(created.body.canonicalRows.allocations.map((row) => row.amount).toSorted()).toEqual([
    "-10.00",
    "10.00",
  ]);
  for (const leg of initial) {
    expect(
      created.body.canonicalRows.allocations.find((row) => row.transactionId === leg.id),
    ).toMatchObject({
      profileId,
      sphereId: profileId,
      amount: leg.amount,
      currencyCode: "USD",
      createdAt: leg.createdAt,
      deletedAt: null,
    });
  }
  expect(
    initial.every(
      (row) => row.type === "TRANSFER" && row.transferId === create[0].payload.transferId,
    ),
  ).toBe(true);
  const createReplay = await pushMutations(page, create);
  expect(createReplay.status).toBe(200);
  expect(createReplay.body).toMatchObject({
    applied: created.body.applied,
    conflicts: created.body.conflicts,
  });
  expect(canonicalLegs(createReplay.body, create)).toEqual(initial);
  expect(createReplay.body.canonicalRows.allocations).toEqual(
    created.body.canonicalRows.allocations,
  );

  const firstEdit = transferMutations(profileId, accounts, ["-20.00", "20.00"], initial);
  const first = await pushMutations(page, firstEdit);
  expect(first.status).toBe(200);
  const staleEdit = transferMutations(profileId, accounts, ["-30.00", "30.00"], initial);
  const accepted = await pushMutations(page, staleEdit);
  expect(accepted.status).toBe(200);
  expect(accepted.body.conflicts).toHaveLength(2);
  expect(
    accepted.body.conflicts.every((conflict) => conflict.classification === "intent-applied"),
  ).toBe(true);
  const acceptedRows = canonicalLegs(accepted.body, staleEdit);
  const laterEdit = transferMutations(profileId, accounts, ["-40.00", "40.00"], acceptedRows);
  // Incoming first: the operation is independent of which leg a caller opened.
  const later = await pushMutations(
    page,
    asOperation(
      [...laterEdit].toReversed().map(({ operation: _operation, ...mutation }) => mutation),
    ),
  );
  expect(later.status).toBe(200);
  const replay = await pushMutations(page, staleEdit);
  expect(replay.status).toBe(200);
  expect(replay.body.conflicts).toEqual(accepted.body.conflicts);
  expect(canonicalLegs(replay.body, staleEdit).map((row) => row.amount)).toEqual([
    "-40.00",
    "40.00",
  ]);
  expect(replay.body.canonicalRows.allocations.map((row) => row.amount).toSorted()).toEqual([
    "-40.00",
    "40.00",
  ]);

  const deletion = deleteTransfer(canonicalLegs(later.body, laterEdit).toReversed());
  const deleted = await pushMutations(page, deletion);
  expect(deleted.status).toBe(200);
  expect(deleted.body.canonicalRows.transactions).toHaveLength(2);
  expect(deleted.body.canonicalRows.transactions.every((row) => row.deletedAt != null)).toBe(true);
  expect(deleted.body.canonicalRows.allocations).toHaveLength(2);
  expect(deleted.body.canonicalRows.allocations.every((row) => row.deletedAt != null)).toBe(true);
  const deleteReplay = await pushMutations(page, deletion);
  expect(deleteReplay.status).toBe(200);
  expect(deleteReplay.body).toMatchObject({
    applied: deleted.body.applied,
    conflicts: deleted.body.conflicts,
  });
  expect(canonicalLegs(deleteReplay.body, deletion)).toEqual(canonicalLegs(deleted.body, deletion));
  const cannotRevive = await pushMutations(
    page,
    transferMutations(profileId, accounts, ["-50.00", "50.00"], acceptedRows),
  );
  expect(cannotRevive.status).toBe(200);
  expect(cannotRevive.body.conflicts.map((conflict) => conflict.classification)).toEqual([
    "canonical-deleted",
    "canonical-deleted",
  ]);
});

test("invalid signs, accounts, profiles, unequal amounts, and incomplete membership roll back rows and receipts", async ({
  authenticatedPage: page,
}) => {
  const { profileId, accounts } = await seedTransferAccounts(page);
  for (const amounts of [
    ["-10.00", "9.00"],
    ["10.00", "10.00"],
    ["0.00", "10.00"],
  ]) {
    const pair = transferMutations(profileId, accounts, amounts);
    expect((await pushMutations(page, pair)).status).toBe(400);
    const corrected = pair.map((mutation, index) => ({
      ...mutation,
      payload: { ...mutation.payload, amount: index === 0 ? "-10.00" : "10.00" },
    }));
    const accepted = await pushMutations(page, corrected);
    expect(accepted.status).toBe(200);
    expect(accepted.body.conflicts).toEqual([]); // A rejected batch claimed no durable receipt.
  }
  expect(
    (await pushMutations(page, transferMutations(profileId, [accounts[0], accounts[0]]))).status,
  ).toBe(400);
  expect(
    (await pushMutations(page, transferMutations(profileId, [accounts[0], accounts[2]]))).status,
  ).toBe(403);
  const pair = transferMutations(profileId, accounts);
  expect((await pushMutations(page, [pair[0]])).status).toBe(400);
  const accepted = await pushMutations(page, pair);
  expect(accepted.status).toBe(200);
  const halfDelete = deleteTransfer(canonicalLegs(accepted.body, pair));
  expect((await pushMutations(page, [halfDelete[0]])).status).toBe(400);
  const edit = transferMutations(
    profileId,
    accounts,
    ["-12.00", "12.00"],
    canonicalLegs(accepted.body, pair),
  );
  expect(
    (
      await pushMutations(
        page,
        edit.map(({ operation: _operation, ...mutation }) => mutation),
      )
    ).status,
  ).toBe(400);
  expect((await pushMutations(page, edit)).status).toBe(200);
});

for (const parent of ["accounts", "profiles"] as const) {
  test(`${parent} deletion cascades across both currency-exchange legs and settles stale pending edits`, async ({
    authenticatedPage: page,
  }) => {
    const { profileId, accounts } = await seedTransferAccounts(page, "EUR");
    const pair = transferMutations(profileId, accounts, ["-10.00", "9.25"]);
    const created = await pushMutations(page, pair);
    expect(created.status).toBe(200);
    const rows = canonicalLegs(created.body, pair);
    expect(rows.map((row) => row.amount)).toEqual(["-10.00", "9.25"]);
    const deleted = await pushMutations(page, [
      {
        mutationId: randomUUID(),
        rowId: parent === "accounts" ? accounts[0] : profileId,
        table: parent,
        op: "delete",
        baseUpdatedAt: null,
      },
    ]);
    expect(deleted.status).toBe(200);
    expect(deleted.body.canonicalRows.transactions).toHaveLength(2);
    expect(deleted.body.canonicalRows.transactions.every((row) => row.deletedAt != null)).toBe(
      true,
    );
    expect(deleted.body.canonicalRows.allocations).toHaveLength(parent === "accounts" ? 3 : 4);
    expect(deleted.body.canonicalRows.allocations.every((row) => row.deletedAt != null)).toBe(true);
    const pending = transferMutations(profileId, accounts, ["-20.00", "18.50"], rows);
    const settled = await pushMutations(page, pending);
    expect(settled.status).toBe(200);
    expect(settled.body.conflicts.map((conflict) => conflict.classification)).toEqual([
      "canonical-deleted",
      "canonical-deleted",
    ]);
    expect((await pushMutations(page, pending)).body.conflicts).toEqual(settled.body.conflicts);
  });
}

test("historical unlinked transfers keep independent edits, categories, and deletion", async ({
  authenticatedPage: page,
}) => {
  const { profileId, accounts } = await seedTransferAccounts(page);
  const categoryId = randomUUID();
  expect(
    (
      await pushMutations(page, [
        {
          mutationId: randomUUID(),
          rowId: categoryId,
          table: "categories",
          op: "upsert",
          baseUpdatedAt: null,
          payload: { name: "Historical category", profileId, colorId: null },
        },
      ])
    ).status,
  ).toBe(200);
  const legacy = transferMutations(profileId, accounts).map(
    ({ operation: _operation, payload: { transferId: _transferId, ...payload }, ...mutation }) => ({
      ...mutation,
      payload: { ...payload, categoryId },
    }),
  );
  const created = await pushMutations(page, legacy);
  expect(created.status).toBe(200);
  expect(created.body.canonicalRows.transactions.every((row) => row.transferId == null)).toBe(true);
  expect(created.body.canonicalRows.allocations).toHaveLength(2);
  const original = canonicalLegs(created.body, legacy);
  const edited = {
    ...legacy[0],
    mutationId: randomUUID(),
    baseUpdatedAt: Date.parse(original[0].updatedAt),
    payload: { ...legacy[0].payload, amount: "-15.00", comment: "Independent legacy edit" },
  };
  const editResult = await pushMutations(page, [edited]);
  expect(editResult.status).toBe(200);
  expect(editResult.body.canonicalRows.transactions[0].categoryId).toBe(categoryId);
  const deletion = {
    mutationId: randomUUID(),
    rowId: legacy[0].rowId,
    table: "transactions" as const,
    op: "delete" as const,
    baseUpdatedAt: null,
  };
  expect((await pushMutations(page, [deletion])).body.canonicalRows.transactions).toHaveLength(1);
  const other = await pushMutations(page, [legacy[1]]);
  expect(other.status).toBe(200);
  expect(other.body.canonicalRows.transactions[0]).toMatchObject({
    id: legacy[1].rowId,
    amount: "10.00",
    deletedAt: null,
    transferId: null,
    categoryId,
  });
});
