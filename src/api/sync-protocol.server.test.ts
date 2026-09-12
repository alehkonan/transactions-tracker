import { describe, expect, it } from "vitest";
import { validateSyncRequest } from "./sync-protocol.server";
import { pushChangesSchema } from "./sync-schemas";

async function expectProtocolError(
  request: unknown,
  expected: { status: number; code: string },
): Promise<void> {
  try {
    validateSyncRequest(pushChangesSchema, request, 41);
    throw new Error("Expected sync request validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    const response = error as Response;
    expect(response.status).toBe(expected.status);
    await expect(response.json()).resolves.toMatchObject({ code: expected.code });
  }
}

describe("validateSyncRequest", () => {
  it("rejects a legacy worker before an empty push can execute", async () => {
    await expectProtocolError(
      { mutations: [] },
      { status: 426, code: "SYNC_PROTOCOL_UNSUPPORTED" },
    );
  });

  it("rejects malformed owner context distinctly from an unsupported protocol", async () => {
    await expectProtocolError(
      { protocolVersion: 2, expectedOwnerUserId: 0, mutations: [] },
      { status: 400, code: "INVALID_SYNC_REQUEST" },
    );
  });

  it("rejects a different authenticated owner without exposing their identity", async () => {
    await expectProtocolError(
      { protocolVersion: 2, expectedOwnerUserId: 42, mutations: [] },
      { status: 409, code: "REPLICA_OWNER_MISMATCH" },
    );
  });

  it("returns validated input when the session matches the replica owner", () => {
    expect(
      validateSyncRequest(
        pushChangesSchema,
        { protocolVersion: 2, expectedOwnerUserId: 41, mutations: [] },
        41,
      ),
    ).toEqual({ protocolVersion: 2, expectedOwnerUserId: 41, mutations: [] });
  });
});
