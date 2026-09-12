import { describe, expect, it } from "vitest";
import { readSyncResponseError } from "./sync-errors";

describe("readSyncResponseError", () => {
  it.each([
    [401, undefined, "UNAUTHORIZED"],
    [409, "REPLICA_OWNER_MISMATCH", "REPLICA_OWNER_MISMATCH"],
    [409, "MUTATION_INTENT_MISMATCH", "MUTATION_INTENT_MISMATCH"],
    [426, "SYNC_PROTOCOL_UNSUPPORTED", "SYNC_PROTOCOL_UNSUPPORTED"],
  ] as const)("distinguishes status %s with code %s", async (status, code, expected) => {
    const response = code
      ? Response.json({ code, error: "Rejected" }, { status })
      : new Response("Unauthorized", { status });

    const error = await readSyncResponseError(response);

    expect(error.code).toBe(expected);
    expect(error.status).toBe(status);
  });
});
