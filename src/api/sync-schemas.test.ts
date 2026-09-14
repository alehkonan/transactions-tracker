import { describe, expect, it } from "vitest";
import { checkIntegritySchema, pullChangesSchema, pushChangesSchema } from "./sync-schemas";

const mutation = {
  mutationId: "01994f62-b486-7000-8000-000000000001",
  rowId: "01994f62-b486-7000-8000-000000000002",
  baseUpdatedAt: null,
  table: "profiles",
  op: "delete",
} as const;

const context = { protocolVersion: 2, expectedOwnerUserId: 41 } as const;

describe("sync request schemas", () => {
  it("requires the versioned replica owner context on every entry point", () => {
    expect(pullChangesSchema.safeParse(context).success).toBe(true);
    expect(checkIntegritySchema.safeParse(context).success).toBe(true);
    expect(pushChangesSchema.safeParse({ ...context, mutations: [mutation] }).success).toBe(true);

    expect(pullChangesSchema.safeParse({}).success).toBe(false);
    expect(checkIntegritySchema.safeParse({}).success).toBe(false);
    expect(pushChangesSchema.safeParse({ mutations: [] }).success).toBe(false);
  });

  it("rejects unsupported protocol versions", () => {
    const unsupported = { protocolVersion: 1, expectedOwnerUserId: 41 };

    expect(pullChangesSchema.safeParse(unsupported).success).toBe(false);
    expect(checkIntegritySchema.safeParse(unsupported).success).toBe(false);
    expect(pushChangesSchema.safeParse({ ...unsupported, mutations: [] }).success).toBe(false);
  });

  it("rejects duplicate mutation ids within one batch", () => {
    const result = pushChangesSchema.safeParse({ ...context, mutations: [mutation, mutation] });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ message: "Mutation ids must be unique within a push batch." }),
      );
    }
  });
});
