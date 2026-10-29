import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeSyncError,
  retryableSyncResponse,
  withSyncPhase,
  withSyncRequest,
} from "./sync-observability.server";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function request(status = 200) {
  return withSyncRequest(
    new Request("https://example.com/_serverFn/encoded-handler", {
      headers: { "x-nf-request-id": "test-request" },
    }),
    "pullChanges",
    async () => new Response(null, { status }),
    (response) => response.status,
  );
}

describe("server console logs", () => {
  it("prints readable development logs without generated URLs or ANSI when color is disabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NO_COLOR", "1");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 10, 9, 4, 59, 7));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await request();
    const line = String(log.mock.calls.at(-1)?.[0]);
    expect(line).toMatch(/^2026-09-10 09:04:59:007 · /);
    expect(line).toContain("INFO · pullChanges · sync.request.completed · GET · 200 ·");
    expect(line).toMatch(/\d+(\.\d+)? ms/);
    expect(line).toContain("requestId=test-request");
    expect(line).not.toContain("/_serverFn/");
    expect(line).not.toContain("\u001b[");
  });

  it("colors status and duration in a terminal", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NO_COLOR", undefined);
    vi.stubEnv("TERM", "xterm-256color");
    const terminal = Object.create(process.stdout);
    Object.defineProperty(terminal, "isTTY", { value: true });
    vi.spyOn(process, "stdout", "get").mockReturnValue(terminal);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await request(503);
    const line = String(log.mock.calls.at(-1)?.[0]);
    expect(line).toContain("\u001b[31m503\u001b[0m");
    expect(line).toContain(" ms\u001b[0m");
  });

  it("preserves structured production logs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await request();
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      level: "info",
      event: "sync.request.completed",
      operation: "pullChanges",
      requestId: "test-request",
      pathname: "/_serverFn/encoded-handler",
      status: 200,
      durationMs: expect.any(Number),
    });
  });

  it("logs the database cause for phase and request failures without query data", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(
      new Error('internal database error: "private-input"\nprivate-context'),
      {
        code: "XX000",
        severity: "ERROR",
        detail: "Failing row contains private-row-value",
        hint: "private-hint",
        query: "private-query",
        parameters: ["private-password"],
      },
    );
    const error = new DrizzleQueryError("private-query", ["private-password"], cause);

    await expect(
      withSyncRequest(
        new Request("https://example.com/_serverFn/signup"),
        "passwordSignUp",
        () =>
          withSyncPhase("auth.password_sign_up.transaction", async () => {
            throw error;
          }),
        () => 200,
      ),
    ).rejects.toBe(error);

    const records = log.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(records.map((record) => record.event)).toEqual([
      "sync.phase.failed",
      "sync.request.failed",
    ]);
    for (const record of records) {
      expect(record).toMatchObject({
        errorName: "DrizzleQueryError",
        errorCode: "XX000",
        errorMessage: "internal database error: <REDACTED>",
        errorClassification: "unexpected",
        retryable: false,
      });
    }
    expect(JSON.stringify(records)).not.toContain("private-");
  });
});

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
      errorMessage: "canceling statement",
      errorClassification: "database_statement_timeout",
      retryable: true,
    });
  });

  it.each([
    ['invalid input syntax: "private-value"', "invalid input syntax: <REDACTED>"],
    ["invalid input: 'private''value'", "invalid input: <REDACTED>"],
    ["invalid input: 'private\\'value'", "invalid input: <REDACTED>"],
    ['invalid input: "private-value', "invalid input: <REDACTED>"],
    ["connection failed: postgres://user:password@db.example/app", "connection failed: <REDACTED>"],
    [
      "authentication failed: password=private-value token:private-token",
      "authentication failed: password=<REDACTED> token=<REDACTED>",
    ],
    ["authorization: Bearer private-token", "authorization=<REDACTED>"],
    ["internal error\nCONTEXT: private-query", "internal error"],
    ["internal\u0000error", "internal error"],
  ])("redacts database message %s", (message, expected) => {
    const cause = Object.assign(new Error(message), { code: "XX000" });
    const error = new DrizzleQueryError("private-query", ["private-password"], cause);
    expect(describeSyncError(error).errorMessage).toBe(expected);
  });

  it("bounds database messages", () => {
    const cause = Object.assign(new Error("x".repeat(1000)), { code: "XX000" });
    expect(describeSyncError(cause).errorMessage).toHaveLength(512);
  });

  it("finds database messages through nested wrappers without falling back to wrapper messages", () => {
    const cause = Object.assign(new Error("internal database error"), { code: "XX000" });
    const error = new Error("private-wrapper", {
      cause: new DrizzleQueryError("private-query", ["private-password"], cause),
    });
    expect(describeSyncError(error).errorMessage).toBe("internal database error");
    expect(
      describeSyncError(new DrizzleQueryError("private-query", ["private-password"])).errorMessage,
    ).toBeUndefined();
    expect(describeSyncError(new Error("private-message")).errorMessage).toBeUndefined();
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
