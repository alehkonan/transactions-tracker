import { describe, expect, it } from "vitest";
import { validateTransferMutations } from "./linked-transfer";
import type { TransferAccount } from "./linked-transfer";
import type { MutationFor, SyncedTransaction } from "~/modules/sync/sync-types";

function history(): SyncedTransaction[] {
  return ["-10.00", "10.00"].map((amount, index) => ({
    id: `leg-${index}`,
    profileId: "profile",
    accountId: `account-${index}`,
    amount,
    type: "TRANSFER",
    transferId: null,
    categoryId: `category-${index}`,
    necessityLevel: "MEDIUM",
    comment: `Original ${index}`,
    createdAt: new Date(`2026-01-0${index + 1}T12:00:00Z`),
    updatedAt: new Date("2026-01-03"),
    deletedAt: null,
  }));
}

const accounts: TransferAccount[] = [0, 1].map((index) => ({
  id: `account-${index}`,
  profileId: "profile",
  currencyCode: "USD",
  deletedAt: null,
}));

function link(rows = history()): MutationFor<"transactions">[] {
  const operation = { id: "link-operation", mutationIds: rows.map((row) => `mutation-${row.id}`) };
  return rows.map(({ id, updatedAt, deletedAt: _deletedAt, ...payload }) => ({
    table: "transactions",
    op: "upsert",
    mutationId: `mutation-${id}`,
    rowId: id,
    baseUpdatedAt: updatedAt.getTime(),
    operation,
    payload: { ...payload, transferId: "pair" },
  }));
}

describe("explicit transfer linking", () => {
  it("links two saved opposite legs without requiring matching dates, comments, or categories", () => {
    expect(validateTransferMutations(link(), history(), accounts).size).toBe(0);
  });

  it("accepts independently recorded amounts for a currency exchange", () => {
    const rows = history();
    rows[1].amount = "9.25";
    expect(
      validateTransferMutations(link(rows), rows, [
        accounts[0],
        { ...accounts[1], currencyCode: "EUR" },
      ]).size,
    ).toBe(0);
    expect(() => validateTransferMutations(link(rows), rows, accounts)).toThrow(
      "Same-currency transfer amounts must match",
    );
  });

  it.each([
    "amount",
    "createdAt",
    "categoryId",
    "comment",
    "necessityLevel",
    "accountId",
    "profileId",
    "sphereId",
  ])("rejects changing %s while linking", (field) => {
    const changes = link();
    const first = changes[0];
    if (first.op !== "upsert") throw new Error("Expected upsert");
    Object.assign(first.payload, {
      [field]:
        field === "createdAt" ? new Date("2025-01-01") : field === "amount" ? "-20.00" : "changed",
    });
    expect(() => validateTransferMutations(changes, history(), accounts)).toThrow(
      "without changing their details or spheres",
    );
  });

  it("rejects incomplete membership, non-Transfer sources, deleted sources, and mixed new/existing records", () => {
    expect(() => validateTransferMutations(link().slice(0, 1), history(), accounts)).toThrow(
      "complete operation",
    );
    for (const rows of [
      [history()[0], { ...history()[1], type: "INCOME" as const }],
      [history()[0], { ...history()[1], deletedAt: new Date() }],
    ])
      expect(() => validateTransferMutations(link(rows), rows, accounts)).toThrow(
        "saved Transfer records",
      );
    expect(() => validateTransferMutations(link(), history().slice(0, 1), accounts)).toThrow(
      "two existing, unpaired",
    );
  });

  it("rejects same-sign, same-account, and cross-profile candidates without guessing a correction", () => {
    const sameSign = history();
    sameSign[1].amount = "-10.00";
    const sameAccount = history();
    sameAccount[1].accountId = "account-0";
    const crossProfile = history();
    crossProfile[1].profileId = "other";
    for (const rows of [sameSign, sameAccount, crossProfile])
      expect(() => validateTransferMutations(link(rows), rows, accounts)).toThrow(
        "outgoing and one incoming",
      );
  });

  it("allows duplicate intent for the same pair and never silently reassigns an existing link", () => {
    const linked = history().map((row) => ({ ...row, transferId: "pair" }));
    expect(validateTransferMutations(link(), linked, accounts).size).toBe(0);
    expect(() =>
      validateTransferMutations(
        link(),
        [{ ...linked[0], transferId: "another-pair" }, linked[1]],
        accounts,
      ),
    ).toThrow("already linked");
  });

  it("does not resurrect saved records deleted by another tab, while allowing a genuinely new pair", () => {
    expect(() => validateTransferMutations(link(), [], accounts)).toThrow("no longer exists");
    const creation = link().map((mutation) => ({ ...mutation, baseUpdatedAt: null }));
    expect(validateTransferMutations(creation, [], accounts).size).toBe(0);
  });
});
