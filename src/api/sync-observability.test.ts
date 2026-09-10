import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeSyncError,
  retryableSyncResponse,
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
