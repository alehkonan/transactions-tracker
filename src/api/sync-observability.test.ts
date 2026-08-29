import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { describeSyncError, retryableSyncResponse } from "./sync-observability.server";

describe("describeSyncError", () => {
  it.each([
    ["55P03", "database_lock_timeout"],
    ["57014", "database_statement_timeout"],
    ["25P03", "database_idle_transaction_timeout"],
    ["25P04", "database_transaction_timeout"],
    ["40001", "database_transaction_retry"],
    ["08006", "database_connection"],
    ["53300", "database_connection"],
    ["ECONNRESET", "network_connection"],
    ["CONNECT_TIMEOUT", "network_connection"],
    ["CONNECTION_CLOSED", "network_connection"],
  ])("classifies retryable error %s", (code, classification) => {
    expect(describeSyncError(Object.assign(new Error("provider failure"), { code }))).toMatchObject(
      {
        errorCode: code,
        errorClassification: classification,
        retryable: true,
      },
    );
  });

  it("unwraps PostgreSQL errors wrapped by Drizzle", () => {
    const postgresError = Object.assign(new Error("canceling statement"), {
      code: "57014",
      severity: "ERROR",
    });
    const error = new DrizzleQueryError("select redacted", [], postgresError);

    expect(describeSyncError(error)).toMatchObject({
      errorName: "DrizzleQueryError",
      errorCode: "57014",
      errorSeverity: "ERROR",
      errorClassification: "database_statement_timeout",
      retryable: true,
    });
  });

  it("does not mark an authorization or constraint error as retryable", () => {
    expect(
      describeSyncError(Object.assign(new Error("constraint failure"), { code: "23505" })),
    ).toMatchObject({
      errorCode: "23505",
      errorClassification: "unexpected",
      retryable: false,
    });
  });
});

describe("retryableSyncResponse", () => {
  it("returns a sanitized 503 with Retry-After for database timeouts", async () => {
    const response = retryableSyncResponse(
      Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }),
    );

    expect(response?.status).toBe(503);
    expect(response?.headers.get("Retry-After")).toBe("2");
    await expect(response?.json()).resolves.toEqual({
      error: "Synchronization is temporarily unavailable. Please retry.",
    });
  });

  it("does not replace an existing HTTP response", () => {
    expect(retryableSyncResponse(new Response("failed", { status: 503 }))).toBeUndefined();
  });
});
