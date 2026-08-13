import { describe, expect, it } from "vitest";
import { computeAccountActivity } from "./compute-account-activity";
import type { SyncedTransaction } from "~/modules/sync/sync-types";

function transaction(overrides: Partial<SyncedTransaction>): SyncedTransaction {
  return {
    id: "t",
    profileId: "p",
    accountId: "a",
    categoryId: null,
    necessityLevel: "MEDIUM",
    type: "EXPENSE",
    amount: "-10.00",
    comment: null,
    createdAt: new Date(2026, 7, 10, 12, 0),
    updatedAt: new Date(2026, 7, 10, 12, 0),
    deletedAt: null,
    ...overrides,
  };
}

const now = new Date(2026, 7, 13, 9, 0);

describe("computeAccountActivity", () => {
  it("reports the newest movement, whatever order the rows arrive in", () => {
    const activity = computeAccountActivity(
      [
        transaction({ id: "1", createdAt: new Date(2026, 7, 2, 8, 0) }),
        transaction({ id: "2", createdAt: new Date(2026, 7, 11, 8, 0) }),
        transaction({ id: "3", createdAt: new Date(2026, 7, 5, 8, 0) }),
      ],
      now,
    );

    expect(activity.get("a")?.lastActivityAt).toEqual(new Date(2026, 7, 11, 8, 0));
  });

  it("nets this month only, in the account's own currency", () => {
    const activity = computeAccountActivity(
      [
        transaction({ id: "1", amount: "-40.50", createdAt: new Date(2026, 7, 3) }),
        transaction({ id: "2", amount: "100.00", createdAt: new Date(2026, 7, 12) }),
        // Last month: counted as activity, not as this month's movement.
        transaction({ id: "3", amount: "-999.00", createdAt: new Date(2026, 6, 30) }),
      ],
      now,
    );

    expect(activity.get("a")?.monthToDateAmount).toBe("59.50");
  });

  it("keeps accounts apart and skips rows filed against none", () => {
    const activity = computeAccountActivity(
      [
        transaction({ id: "1", accountId: "a", amount: "-10.00" }),
        transaction({ id: "2", accountId: "b", amount: "-25.00" }),
        transaction({ id: "3", accountId: null, amount: "-99.00" }),
      ],
      now,
    );

    expect(activity.get("a")?.monthToDateAmount).toBe("-10.00");
    expect(activity.get("b")?.monthToDateAmount).toBe("-25.00");
    expect(activity.size).toBe(2);
  });

  it("has no entry for an account that has never moved", () => {
    expect(computeAccountActivity([], now).get("a")).toBeUndefined();
  });
});
