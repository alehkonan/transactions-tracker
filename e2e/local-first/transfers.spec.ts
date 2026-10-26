import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { E2E_ACCOUNT_NAME, openSecondDevice, test, waitForSynced } from "../fixtures/auth";
import {
  expectOperatingReconciled,
  pushMutations,
  readFinancialReplica,
  transferMutations,
} from "../fixtures/transfers";
import type { Page } from "@playwright/test";

async function prepareAccounts(page: Page, currency = "USD") {
  await page.goto("/accounts");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))))
    await page.reload();
  await waitForSynced(page);
  await page.getByTestId("account-create").click();
  await page.getByTestId("account-name").fill("Transfer destination");
  await page.getByTestId("account-currency").selectOption(currency);
  await page.getByTestId("account-submit").click();
  await waitForSynced(page);
  const { accounts } = await readFinancialReplica(page);
  const source = accounts.find((account) => account.name === E2E_ACCOUNT_NAME)!;
  const destination = accounts.find((account) => account.name === "Transfer destination")!;
  await page.goto("/transactions");
  await expect(page.getByTestId("transaction-create")).toBeEnabled();
  return { source, destination };
}

async function fillTransfer(
  page: Page,
  sourceId: string,
  destinationId: string,
  amount = "10.00",
  toAmount = amount,
) {
  await page.getByTestId("transaction-create").click();
  await page.getByTestId("transaction-type-TRANSFER").click();
  await page.getByTestId("transaction-account").selectOption(sourceId);
  await page.getByTestId("transaction-to-account").selectOption(destinationId);
  await page.getByTestId("transaction-amount").fill(amount);
  await page.getByTestId("transaction-to-amount").fill(toAmount);
  await page.getByTestId("transaction-comment").fill("Linked transfer lifecycle");
}

test("manual selection links saved records offline, preserves their history through replay, and enables whole-transfer editing and deletion", async ({
  onboardedPage: page,
  context,
  authCredentials,
}) => {
  const { source, destination } = await prepareAccounts(page);
  const legacy = transferMutations(source.profileId, [source.id, destination.id]).map(
    (
      { operation: _operation, payload: { transferId: _transferId, ...payload }, ...mutation },
      index,
    ) => ({
      ...mutation,
      payload: {
        ...payload,
        comment: `Manual link saved leg ${index}`,
        createdAt: new Date(`2026-01-0${index + 1}T12:00:00Z`),
      },
    }),
  );
  const invalid = [
    {
      ...legacy[0],
      mutationId: randomUUID(),
      rowId: randomUUID(),
      payload: { ...legacy[0].payload, comment: "Same direction" },
    },
    {
      ...legacy[1],
      mutationId: randomUUID(),
      rowId: randomUUID(),
      payload: { ...legacy[1].payload, amount: "9.00", comment: "Mismatched amount" },
    },
  ];
  expect((await pushMutations(page, [...legacy, ...invalid])).status).toBe(200);
  await page.getByTestId("sync-status").click();
  await expect.poll(async () => (await readFinancialReplica(page)).transactions.length).toBe(4);
  await waitForSynced(page);
  const original = await readFinancialReplica(page);
  expect(original.transactions.every((row) => row.transferId == null)).toBe(true);
  await context.setOffline(true);
  await page.getByTestId(`transaction-${legacy[0].rowId}`).click();
  await expect(page.getByTestId("transfer-counterpart")).toHaveValue("");
  await page.getByTestId("transfer-counterpart").selectOption(invalid[0].rowId);
  await page.getByTestId("transfer-link").click();
  await expect(page.getByTestId("transaction-error")).toContainText(
    "one outgoing and one incoming",
  );
  expect((await readFinancialReplica(page)).outbox).toEqual([]);
  await page.getByTestId("transfer-counterpart").selectOption(invalid[1].rowId);
  await page.getByTestId("transfer-link").click();
  await expect(page.getByTestId("transaction-error")).toContainText(
    "Same-currency transfer amounts must match",
  );
  expect((await readFinancialReplica(page)).transactions).toEqual(original.transactions);
  await page.getByTestId("transfer-counterpart").selectOption(legacy[1].rowId);
  await page.getByTestId("transfer-link").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const linked = await readFinancialReplica(page);
  expect(linked.transactions).toHaveLength(4);
  const pair = linked.transactions.filter((row) => row.transferId);
  expect(pair.map((row) => row.id).toSorted()).toEqual(legacy.map((row) => row.rowId).toSorted());
  expect(pair[0].transferId).toBe(pair[1].transferId);
  expect(linked.outbox).toHaveLength(2);
  expect(linked.outbox[0].operation).toEqual(linked.outbox[1].operation);
  for (const row of pair) {
    const saved = original.transactions.find((item) => item.id === row.id)!;
    expect(row).toEqual({ ...saved, transferId: row.transferId });
  }
  for (const row of linked.allocations) {
    const saved = original.allocations.find((item) => item.id === row.id)!;
    expect(row).toMatchObject({
      sphereId: saved.sphereId,
      amount: saved.amount,
      createdAt: saved.createdAt,
      currencyCode: saved.currencyCode,
      transactionId: saved.transactionId,
      openingAccountId: saved.openingAccountId,
    });
  }
  expectOperatingReconciled(linked);
  await page.reload();
  await expect(page.getByTestId(`transaction-${legacy[1].rowId}`)).toBeVisible();
  expect((await readFinancialReplica(page)).outbox).toEqual(linked.outbox);

  let lost = false;
  await page.route("**/_serverFn/**", async (route) => {
    const body = route.request().postData() ?? "";
    if (!lost && body.includes('"mutations"') && body.includes('"TRANSFER"')) {
      await route.fetch();
      lost = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await expect.poll(() => lost).toBe(true);
  await context.setOffline(true);
  expect((await readFinancialReplica(page)).outbox).toEqual(linked.outbox);
  await page.reload();
  await expect(page.getByTestId(`transaction-${legacy[1].rowId}`)).toBeVisible();
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  expect((await readFinancialReplica(page)).transactions).toHaveLength(4);

  const second = await openSecondDevice(page, authCredentials);
  try {
    const remote = await readFinancialReplica(second.page);
    for (const row of remote.transactions.filter((row) => row.transferId)) {
      const { updatedAt: _updatedAt, ...saved } = pair.find((item) => item.id === row.id)!;
      expect(row).toMatchObject(saved);
    }
  } finally {
    await second.context.close();
  }

  await context.setOffline(true);
  await page.getByTestId(`transaction-${legacy[1].rowId}`).click();
  await expect(page.getByTestId("transfer-counterpart")).toHaveCount(0);
  await expect(page.getByTestId("transaction-to-account")).toHaveValue(destination.id);
  await page.getByTestId("transaction-amount").fill("20.00");
  await page.getByTestId("transaction-to-amount").fill("20.00");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const edited = await readFinancialReplica(page);
  expect(
    edited.transactions
      .filter((row) => row.transferId)
      .map((row) => row.amount)
      .toSorted(),
  ).toEqual(["-20.00", "20.00"]);
  expectOperatingReconciled(edited);
  await page.getByTestId(`transaction-${legacy[0].rowId}`).click();
  await page.getByTestId("transaction-delete").click();
  await page.getByTestId("transaction-delete-confirm").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const deleted = await readFinancialReplica(page);
  expect(deleted.transactions.map((row) => row.id).toSorted()).toEqual(
    invalid.map((row) => row.rowId).toSorted(),
  );
  expect(
    deleted.allocations.some((row) => legacy.some((leg) => row.transactionId === leg.rowId)),
  ).toBe(false);
  expectOperatingReconciled(deleted);
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
});

test("either transfer leg edits the whole operation offline, survives reload, and deletes on another device", async ({
  onboardedPage: page,
  context,
  authCredentials,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { source, destination } = await prepareAccounts(page);
  await context.setOffline(true);
  await fillTransfer(page, source.id, destination.id);
  await page.getByTestId("transaction-to-amount").fill("9.00");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-to-amount")).toHaveAttribute("aria-invalid", "true");
  expect((await readFinancialReplica(page)).outbox).toEqual([]);
  await page.getByTestId("transaction-to-amount").fill("10.00");
  // Failure on the second row must roll back the first row and both pending intents.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let count = 0;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "transactions" && ++count === 2) {
        IDBObjectStore.prototype.put = original;
        throw new DOMException("Injected local write failure", "QuotaExceededError");
      }
      return Reflect.apply(original, this, args);
    };
  });
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-error")).toContainText("Injected local write failure");
  expect((await readFinancialReplica(page)).transactions).toEqual([]);
  expect((await readFinancialReplica(page)).outbox).toEqual([]);
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const initial = await readFinancialReplica(page);
  expectOperatingReconciled(initial);
  expect(initial.allocations).toHaveLength(4);
  expect(initial.transactions.map((row) => row.amount).toSorted()).toEqual(["-10.00", "10.00"]);
  expect(initial.outbox).toHaveLength(2);
  expect(initial.outbox[0].operation).toEqual(initial.outbox[1].operation);
  expect(initial.outbox[0].operation?.mutationIds).toHaveLength(2);
  await page.reload();
  await expect(page.getByTestId(`transaction-${initial.transactions[0].id}`)).toBeVisible();
  expect((await readFinancialReplica(page)).outbox).toEqual(initial.outbox);
  expectOperatingReconciled(await readFinancialReplica(page));
  const incoming = initial.transactions.find((row) => Number(row.amount) > 0)!;
  const outgoing = initial.transactions.find((row) => Number(row.amount) < 0)!;
  await page.getByTestId(`transaction-${incoming.id}`).click();
  await expect(page.getByTestId("transaction-account")).toHaveValue(source.id);
  await expect(page.getByTestId("transaction-to-account")).toHaveValue(destination.id);
  await page.getByTestId("transaction-amount").fill("25.00");
  await page.getByTestId("transaction-to-amount").fill("25.00");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  expect(
    (await readFinancialReplica(page)).transactions.map((row) => row.amount).toSorted(),
  ).toEqual(["-25.00", "25.00"]);
  await page.getByTestId(`transaction-${outgoing.id}`).click();
  await expect(page.getByTestId("transaction-amount")).toHaveValue("25.00");
  await expect(page.getByTestId("transaction-to-amount")).toHaveValue("25.00");
  await page.getByTestId("transaction-cancel").click();
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  const second = await openSecondDevice(page, authCredentials);
  try {
    expectOperatingReconciled(await readFinancialReplica(second.page));
    expect(
      (await readFinancialReplica(second.page)).transactions.map((row) => row.amount).toSorted(),
    ).toEqual(["-25.00", "25.00"]);
    await second.page.getByTestId(`transaction-${incoming.id}`).click();
    await second.page.getByTestId("transaction-delete").click();
    await second.page.getByTestId("transaction-delete-confirm").click();
    await expect(second.page.getByTestId("transaction-form")).toHaveCount(0);
    await waitForSynced(second.page);
    expect((await readFinancialReplica(second.page)).transactions).toEqual([]);
    expectOperatingReconciled(await readFinancialReplica(second.page));
    await page.getByTestId("sync-status").click();
    await expect.poll(async () => (await readFinancialReplica(page)).transactions).toEqual([]);
  } finally {
    await second.context.close();
  }
});

test("an account cascade removes both local transfer legs and synchronizes their tombstones", async ({
  onboardedPage: page,
  context,
  authCredentials,
}) => {
  const { source, destination } = await prepareAccounts(page);
  await fillTransfer(page, source.id, destination.id);
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  await waitForSynced(page);
  await page.goto("/accounts");
  await context.setOffline(true);
  await page.getByTestId(`account-${source.id}`).click();
  await page.getByTestId("account-delete").click();
  await page.getByTestId("account-delete-confirm").click();
  await expect(page.getByTestId("account-form")).toHaveCount(0);
  const deleted = await readFinancialReplica(page);
  expectOperatingReconciled(deleted);
  expect(deleted.allocations).toHaveLength(1);
  expect(deleted.transactions).toEqual([]);
  expect(deleted.accounts.map((account) => account.id)).toEqual([destination.id]);
  expect(deleted.outbox).toMatchObject([{ table: "accounts", op: "delete", rowId: source.id }]);
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  const second = await openSecondDevice(page, authCredentials);
  try {
    expect((await readFinancialReplica(second.page)).transactions).toEqual([]);
    expect((await readFinancialReplica(second.page)).accounts.map((account) => account.id)).toEqual(
      [destination.id],
    );
  } finally {
    await second.context.close();
  }
});

test("a delayed accepted response cannot restore allocations after an offline account cascade", async ({
  onboardedPage: page,
  context,
}) => {
  const { source, destination } = await prepareAccounts(page);
  await context.setOffline(true);
  await fillTransfer(page, source.id, destination.id);
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  let accepted = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_serverFn/**", async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"mutations"')) return route.continue();
    if (!accepted && body.includes('"TRANSFER"')) {
      const response = await route.fetch();
      accepted = true;
      await held;
      await route.fulfill({ response });
    } else await route.abort("failed");
  });
  await context.setOffline(false);
  await expect.poll(() => accepted).toBe(true);
  await page.getByTestId("nav-accounts").click();
  await page.getByTestId(`account-${source.id}`).click();
  await page.getByTestId("account-delete").click();
  await page.getByTestId("account-delete-confirm").click();
  await expect(page.getByTestId("account-form")).toHaveCount(0);
  release();
  await expect.poll(async () => (await readFinancialReplica(page)).outbox.length).toBe(1);
  await context.setOffline(true);
  const local = await readFinancialReplica(page);
  expect(local.transactions).toEqual([]);
  expect(local.allocations).toHaveLength(1);
  expectOperatingReconciled(local);
  await page.reload();
  await expect(page.getByTestId(`account-${destination.id}`)).toBeVisible();
  expectOperatingReconciled(await readFinancialReplica(page));
});

test("failed durable settlement retains both accepted intents through reload and receipt replay", async ({
  onboardedPage: page,
  context,
  authCredentials,
}) => {
  const { source, destination } = await prepareAccounts(page);
  await context.setOffline(true);
  await fillTransfer(page, source.id, destination.id);
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const pending = await readFinancialReplica(page);
  expectOperatingReconciled(pending);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.delete;
    const counts = new WeakMap<IDBTransaction, number>();
    IDBObjectStore.prototype.delete = function (...args) {
      if (this.name === "outbox") {
        const count = (counts.get(this.transaction) ?? 0) + 1;
        counts.set(this.transaction, count);
        if (count === 2) {
          this.transaction.abort();
          localStorage.setItem("transfer-settlement-aborted", "yes");
          return undefined as unknown as IDBRequest<undefined>;
        }
      }
      return Reflect.apply(original, this, args);
    };
  });
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("transfer-settlement-aborted")))
    .toBe("yes");
  await context.setOffline(true);
  expect((await readFinancialReplica(page)).outbox).toEqual(pending.outbox);
  expect((await readFinancialReplica(page)).transactions).toEqual(pending.transactions);
  const second = await openSecondDevice(page, authCredentials);
  try {
    expect(
      (await readFinancialReplica(second.page)).transactions.map((row) => row.id).toSorted(),
    ).toEqual(pending.transactions.map((row) => row.id).toSorted());
  } finally {
    await second.context.close();
  }
  await page.reload();
  await expect(page.getByTestId(`transaction-${pending.transactions[0].id}`)).toBeVisible();
  expect((await readFinancialReplica(page)).outbox).toEqual(pending.outbox);
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  const settled = await readFinancialReplica(page);
  expectOperatingReconciled(settled);
  expect(settled.outbox).toEqual([]);
  expect(settled.transactions.map((row) => row.id).toSorted()).toEqual(
    pending.transactions.map((row) => row.id).toSorted(),
  );
});

test("same-currency validation rejects unequal values and exchange edits keep independently entered amounts", async ({
  onboardedPage: page,
  context,
}) => {
  const { source, destination } = await prepareAccounts(page, "EUR");
  await context.setOffline(true);
  await fillTransfer(page, source.id, source.id, "10.00", "9.25");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-to-account")).toHaveAttribute("aria-invalid", "true");
  expect((await readFinancialReplica(page)).transactions).toEqual([]);
  await page.getByTestId("transaction-to-account").selectOption(destination.id);
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const before = await readFinancialReplica(page);
  expectOperatingReconciled(before);
  expect(before.transactions.map((row) => row.amount).toSorted()).toEqual(["-10.00", "9.25"]);
  const incoming = before.transactions.find((row) => Number(row.amount) > 0)!;
  await page.getByTestId(`transaction-${incoming.id}`).click();
  await expect(page.getByTestId("transaction-to-amount")).toHaveValue("9.25");
  await page.getByTestId("transaction-amount").fill("20.00");
  await expect(page.getByTestId("transaction-to-amount")).toHaveValue("9.25");
  await page.getByTestId("transaction-to-amount").fill("18.50");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  expect(
    (await readFinancialReplica(page)).transactions.map((row) => row.amount).toSorted(),
  ).toEqual(["-20.00", "18.50"]);
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
});

test("editing and deleting an unlinked historical leg preserves its category and leaves its apparent partner independent", async ({
  onboardedPage: page,
  context,
  authCredentials,
}) => {
  const { source, destination } = await prepareAccounts(page);
  const categoryId = randomUUID();
  const legacy = transferMutations(source.profileId, [source.id, destination.id]).map(
    ({ operation: _operation, payload: { transferId: _transferId, ...payload }, ...mutation }) => ({
      ...mutation,
      payload: { ...payload, categoryId },
    }),
  );
  expect(
    (
      await pushMutations(page, [
        {
          mutationId: randomUUID(),
          rowId: categoryId,
          table: "categories",
          op: "upsert",
          baseUpdatedAt: null,
          payload: {
            name: "Historical transfer category",
            colorId: null,
            profileId: source.profileId,
          },
        },
        ...legacy,
      ])
    ).status,
  ).toBe(200);
  await page.getByTestId("sync-status").click();
  await expect.poll(async () => (await readFinancialReplica(page)).transactions.length).toBe(2);
  await waitForSynced(page);
  const original = await readFinancialReplica(page);
  await context.setOffline(true);
  await page.getByTestId(`transaction-${legacy[0].rowId}`).click();
  await expect(page.getByTestId("transaction-to-account")).toHaveCount(0);
  await page.getByTestId("transaction-comment").fill("Edited historical comment");
  await page.getByTestId("transaction-submit").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  const edited = await readFinancialReplica(page);
  expect(edited.transactions.find((row) => row.id === legacy[0].rowId)).toMatchObject({
    categoryId,
    amount: "-10.00",
    transferId: null,
    comment: "Edited historical comment",
  });
  expect(edited.transactions.find((row) => row.id === legacy[1].rowId)).toEqual(
    original.transactions.find((row) => row.id === legacy[1].rowId),
  );
  await page.getByTestId(`transaction-${legacy[0].rowId}`).click();
  await page.getByTestId("transaction-delete").click();
  await page.getByTestId("transaction-delete-confirm").click();
  await expect(page.getByTestId("transaction-form")).toHaveCount(0);
  expect((await readFinancialReplica(page)).transactions.map((row) => row.id)).toEqual([
    legacy[1].rowId,
  ]);
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  const second = await openSecondDevice(page, authCredentials);
  try {
    expect((await readFinancialReplica(second.page)).transactions).toMatchObject([
      { id: legacy[1].rowId, categoryId, amount: "10.00", transferId: null },
    ]);
  } finally {
    await second.context.close();
  }
});

test("CSV transfer at a push boundary survives a lost response and reload without duplicating a leg", async ({
  onboardedPage: page,
  context,
  authCredentials,
}) => {
  test.setTimeout(60_000);
  const { source, destination } = await prepareAccounts(page);
  await page.goto("/transactions-import");
  await context.setOffline(true);
  const headers =
    "categoryName,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle,createdDate";
  const expenses = Array.from(
    { length: 499 },
    (_, index) => `,Boundary expense ${index},${source.name},1,USD,,,,2026-01-01`,
  );
  const transfer = `,Boundary transfer,${source.name},10,USD,${destination.name},10,USD,2026-01-01`;
  const invalid = `,Mismatching transfer,${source.name},10,USD,${destination.name},9,USD,2026-01-01`;
  await page.getByTestId("import-file").setInputFiles({
    name: "transfer-boundary.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([headers, ...expenses, transfer, invalid].join("\n")),
  });
  await page.getByTestId("import-next").click();
  await expect(page.getByTestId("import-report")).toBeVisible();
  await expect(page.getByTestId("import-failures")).toContainText(
    "Same-currency transfer amounts must match",
  );
  const imported = await readFinancialReplica(page);
  expectOperatingReconciled(imported);
  expect(imported.allocations).toHaveLength(503);
  expect(imported.transactions).toHaveLength(501);
  expect(imported.outbox).toHaveLength(501);
  const transferIntents = imported.outbox.filter(
    (entry) =>
      entry.table === "transactions" && entry.op === "upsert" && entry.payload.type === "TRANSFER",
  );
  expect(transferIntents).toHaveLength(2);
  expect(transferIntents.map((entry) => entry.seq)).toEqual([
    imported.outbox[499].seq,
    imported.outbox[500].seq,
  ]);
  await page.getByTestId("import-proceed").click();
  let lost = false;
  const pushSizes: number[] = [];
  await page.route("**/_serverFn/**", async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"mutations"')) return route.continue();
    pushSizes.push((body.match(/"mutationId"/g) ?? []).length);
    if (body.includes('"TRANSFER"') && !lost) {
      await route.fetch(); // The real server commits before the client loses the response.
      lost = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await expect.poll(() => lost).toBe(true);
  await context.setOffline(true);
  expect((await readFinancialReplica(page)).outbox).toEqual(transferIntents);
  expect(pushSizes).toEqual([499, 2]);
  await page.reload();
  await expect(page.getByTestId("transaction-create")).toBeVisible();
  expect((await readFinancialReplica(page)).outbox).toEqual(transferIntents);
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  const settled = await readFinancialReplica(page);
  expect(settled.outbox).toEqual([]);
  expect(settled.transactions).toHaveLength(501);
  expect(
    settled.transactions
      .filter((row) => row.transferId)
      .map((row) => row.id)
      .toSorted(),
  ).toEqual(transferIntents.map((entry) => entry.rowId).toSorted());
  const second = await openSecondDevice(page, authCredentials);
  try {
    const remote = await readFinancialReplica(second.page);
    expectOperatingReconciled(remote);
    expect(remote.allocations).toHaveLength(503);
    expect(remote.transactions).toHaveLength(501);
    expect(
      remote.transactions
        .filter((row) => row.transferId)
        .map((row) => row.id)
        .toSorted(),
    ).toEqual(transferIntents.map((entry) => entry.rowId).toSorted());
  } finally {
    await second.context.close();
  }
});
