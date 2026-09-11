import { describe, expect, it } from "vitest";
import { classifyLegacyOwnership } from "./replica-identity";

describe("classifyLegacyOwnership", () => {
  it("leaves an empty v2 replica unbound", () => {
    expect(
      classifyLegacyOwnership({
        profiles: [],
        accounts: [],
        categories: [],
        transactions: [],
        outbox: [],
      }),
    ).toEqual({ kind: "unbound" });
  });

  it("retains one consistent profile owner as a candidate without granting authority", () => {
    expect(
      classifyLegacyOwnership({
        profiles: [{ id: "profile-a", userId: 41 }],
        accounts: [{ id: "account-a", profileId: "profile-a" }],
        categories: [{ id: "category-a", profileId: "profile-a" }],
        transactions: [
          {
            id: "transaction-a",
            profileId: "profile-a",
            accountId: "account-a",
            categoryId: "category-a",
          },
        ],
        outbox: [
          {
            table: "transactions",
            rowId: "transaction-a",
            op: "upsert",
            payload: {
              profileId: "profile-a",
              accountId: "account-a",
              categoryId: "category-a",
            },
          },
        ],
      }),
    ).toEqual({ kind: "candidate", ownerUserId: 41 });
  });

  it.each([
    {
      name: "mixed owners",
      data: {
        profiles: [
          { id: "profile-a", userId: 41 },
          { id: "profile-b", userId: 42 },
        ],
        accounts: [],
        categories: [],
        transactions: [],
        outbox: [],
      },
      reason: "mixed-profile-owners",
    },
    {
      name: "outbox without owned rows",
      data: {
        profiles: [],
        accounts: [],
        categories: [],
        transactions: [],
        outbox: [{ table: "accounts", rowId: "account-a", op: "delete" }],
      },
      reason: "missing-profile-owner",
    },
    {
      name: "locally-created profiles only",
      data: {
        profiles: [{ id: "profile-a", userId: null }],
        accounts: [],
        categories: [],
        transactions: [],
        outbox: [],
      },
      reason: "missing-profile-owner",
    },
    {
      name: "inconsistent references",
      data: {
        profiles: [{ id: "profile-a", userId: 41 }],
        accounts: [{ id: "account-a", profileId: "missing-profile" }],
        categories: [],
        transactions: [],
        outbox: [],
      },
      reason: "inconsistent-references",
    },
    {
      name: "an outbox obligation without a matching local row",
      data: {
        profiles: [{ id: "profile-a", userId: 41 }],
        accounts: [],
        categories: [],
        transactions: [],
        outbox: [{ table: "accounts", rowId: "missing-account", op: "delete" }],
      },
      reason: "inconsistent-references",
    },
  ])("requires recovery for $name", ({ data, reason }) => {
    const result = classifyLegacyOwnership(data);

    expect(result.kind).toBe("recovery-required");
    if (result.kind === "recovery-required") expect(result.reasons).toContain(reason);
  });
});
