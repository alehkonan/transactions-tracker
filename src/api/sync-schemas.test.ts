import { describe, expect, it } from "vitest";
import { pushChangesSchema } from "./sync-schemas";

const mutation = {
  mutationId: "01994f62-b486-7000-8000-000000000001",
  rowId: "01994f62-b486-7000-8000-000000000002",
  baseUpdatedAt: null,
  table: "profiles",
  op: "delete",
} as const;

describe("pushChangesSchema", () => {
  it("accepts unique mutation ids", () => {
    expect(pushChangesSchema.safeParse({ mutations: [mutation] }).success).toBe(true);
  });

  it("rejects duplicate mutation ids within one batch", () => {
    const result = pushChangesSchema.safeParse({ mutations: [mutation, mutation] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ message: "Mutation ids must be unique within a push batch." }),
      );
    }
  });
});
