import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { format } from "date-fns";
import type { Mutation } from "~/modules/sync/sync-types";

const MAX_PHASE_RECORDS = 100;
const MAX_ERROR_CAUSE_DEPTH = 5;
const isolateId = randomUUID();
let requestCount = 0;

type LogValue = boolean | number | string | null | undefined;
type LogFields = Record<string, LogValue | LogValue[] | Record<string, number>>;

type RequestLogContext = {
  requestId: string;
  netlifyRequestId?: string;
  operation: string;
  method: string;
  pathname: string;
  cold: boolean;
  phaseRecords: number;
  phaseLimitReported: boolean;
  loggedPhaseErrors: WeakSet<object>;
};

type ErrorDetails = {
  errorName: string;
  errorCode?: string;
  errorSeverity?: string;
  errorClassification: string;
  retryable: boolean;
};

const requestLogStorage = new AsyncLocalStorage<RequestLogContext>();

function text(value: LogFields[string]): string | undefined {
  // Keep log values on one line and prevent injected terminal escape sequences.
  // oxlint-disable-next-line no-control-regex
  const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/g;
  return typeof value === "string" ? value.replace(controlCharacters, " ") : JSON.stringify(value);
}

function formatConsoleRecord(record: LogFields, color: boolean): string {
  const paint = (label: string, code: number) =>
    color ? `\u001b[${code}m${label}\u001b[0m` : label;
  const parts = [
    paint(format(new Date(String(record.timestamp)), "yyyy-MM-dd HH:mm:ss:SSS"), 90),
    paint(
      String(record.level).toUpperCase(),
      record.level === "error" ? 31 : record.level === "warn" ? 33 : 32,
    ),
    paint(String(text(record.operation ?? "runtime")), 36),
    String(text(record.event)),
  ];
  if (record.phase != null) parts.push(paint(String(text(record.phase)), 36));
  if (record.method != null) parts.push(String(text(record.method)));
  if (typeof record.status === "number") {
    parts.push(
      paint(String(record.status), record.status >= 500 ? 31 : record.status >= 400 ? 33 : 32),
    );
  }
  if (typeof record.durationMs === "number") {
    parts.push(
      paint(
        `${record.durationMs} ms`,
        record.durationMs >= 1000 ? 31 : record.durationMs >= 250 ? 33 : 32,
      ),
    );
  }
  if (record.cold === true) parts.push(paint("cold start", 33));

  const displayed = new Set([
    "timestamp",
    "level",
    "operation",
    "event",
    "phase",
    "method",
    "status",
    "durationMs",
    "cold",
  ]);
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || displayed.has(key)) continue;
    // Generated server-function URLs add noise; the operation identifies the handler.
    if (key === "pathname" && typeof value === "string" && value.startsWith("/_serverFn/"))
      continue;
    parts.push(paint(`${key}=${text(value)}`, key.endsWith("Id") ? 90 : 37));
  }
  return parts.join(" · ");
}

function emit(level: "error" | "info" | "warn", event: string, fields: LogFields = {}): void {
  const context = requestLogStorage.getStore();
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    isolateId,
    ...(context == null
      ? {}
      : {
          requestId: context.requestId,
          netlifyRequestId: context.netlifyRequestId,
          operation: context.operation,
          method: context.method,
          pathname: context.pathname,
          cold: context.cold,
        }),
    ...fields,
  };
  const stream = level === "info" ? process.stdout : process.stderr;
  const color =
    Boolean(stream.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
  const line =
    process.env.NODE_ENV === "production"
      ? JSON.stringify(record)
      : formatConsoleRecord(record, color);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

if (typeof window === "undefined" && process.env.NODE_ENV !== "test") {
  emit("info", "runtime.isolate.initialized");
}

function stringProperty(error: unknown, property: string): string | undefined {
  if (typeof error !== "object" || error == null || !(property in error)) return undefined;
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorCauseChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<object>();
  let current = error;

  while (chain.length < MAX_ERROR_CAUSE_DEPTH) {
    chain.push(current);
    if (typeof current !== "object" || current == null || seen.has(current)) break;
    seen.add(current);
    if (!("cause" in current)) break;
    current = (current as { cause?: unknown }).cause;
  }

  return chain;
}

function errorName(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  if (error.name !== "Error") return error.name;
  return error.constructor.name || error.name;
}

export function describeSyncError(error: unknown): ErrorDetails {
  if (error instanceof Response) {
    return {
      errorName: "Response",
      errorCode: String(error.status),
      errorClassification: "http_response",
      retryable: error.status === 408 || error.status === 429 || error.status >= 500,
    };
  }

  const chain = errorCauseChain(error);
  const name = errorName(error);
  const code = chain.map((candidate) => stringProperty(candidate, "code")).find(Boolean);
  const severity = chain.map((candidate) => stringProperty(candidate, "severity")).find(Boolean);
  const timeoutName = chain
    .map((candidate) => (candidate instanceof Error ? candidate.name : undefined))
    .find((candidate) => candidate === "AbortError" || candidate === "TimeoutError");

  if (code === "55P03") {
    return {
      errorName: name,
      errorCode: code,
      errorSeverity: severity,
      errorClassification: "database_lock_timeout",
      retryable: true,
    };
  }
  if (code === "57014") {
    return {
      errorName: name,
      errorCode: code,
      errorSeverity: severity,
      errorClassification: "database_statement_timeout",
      retryable: true,
    };
  }
  if (code === "25P03") {
    return {
      errorName: name,
      errorCode: code,
      errorSeverity: severity,
      errorClassification: "database_idle_transaction_timeout",
      retryable: true,
    };
  }
  if (code === "25P04") {
    return {
      errorName: name,
      errorCode: code,
      errorSeverity: severity,
      errorClassification: "database_transaction_timeout",
      retryable: true,
    };
  }
  if (code === "40001" || code === "40P01") {
    return {
      errorName: name,
      errorCode: code,
      errorSeverity: severity,
      errorClassification: "database_transaction_retry",
      retryable: true,
    };
  }
  if (
    code?.startsWith("08") ||
    code === "53300" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03"
  ) {
    return {
      errorName: name,
      errorCode: code,
      errorSeverity: severity,
      errorClassification: "database_connection",
      retryable: true,
    };
  }
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH" ||
    code === "EAI_AGAIN" ||
    code === "CONNECT_TIMEOUT" ||
    code === "CONNECTION_CLOSED" ||
    code === "CONNECTION_DESTROYED"
  ) {
    return {
      errorName: name,
      errorCode: code,
      errorClassification: "network_connection",
      retryable: true,
    };
  }
  if (timeoutName) {
    return {
      errorName: name,
      errorCode: code,
      errorClassification: "operation_timeout",
      retryable: true,
    };
  }

  return {
    errorName: name,
    errorCode: code,
    errorSeverity: severity,
    errorClassification: "unexpected",
    retryable: false,
  };
}

export function retryableSyncResponse(error: unknown): Response | undefined {
  const details = describeSyncError(error);
  if (!details.retryable || details.errorClassification === "http_response") return undefined;

  return Response.json(
    { error: "Synchronization is temporarily unavailable. Please retry." },
    { status: 503, headers: { "Retry-After": "2" } },
  );
}

export function logSyncEvent(event: string, fields: LogFields = {}): void {
  if (requestLogStorage.getStore() == null) return;
  emit("info", event, fields);
}

function claimPhaseRecord(): boolean {
  const context = requestLogStorage.getStore();
  if (context == null) return false;
  if (context.phaseRecords < MAX_PHASE_RECORDS) {
    context.phaseRecords += 1;
    return true;
  }
  if (!context.phaseLimitReported) {
    context.phaseLimitReported = true;
    emit("warn", "sync.phase.log_limit_reached", { maxPhaseRecords: MAX_PHASE_RECORDS });
  }
  return false;
}

export async function withSyncPhase<T>(
  phase: string,
  work: () => Promise<T>,
  fields: LogFields = {},
  resultFields?: (result: T) => LogFields,
  options?: { failureLevel?: "error" | "warn" },
): Promise<T> {
  if (requestLogStorage.getStore() == null) return work();

  const startedAt = performance.now();
  if (claimPhaseRecord()) emit("info", "sync.phase.started", { phase, ...fields });

  try {
    const result = await work();
    if (claimPhaseRecord()) {
      emit("info", "sync.phase.completed", {
        phase,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        ...fields,
        ...resultFields?.(result),
      });
    }
    return result;
  } catch (error) {
    const context = requestLogStorage.getStore();
    const objectError = typeof error === "object" && error != null ? error : undefined;
    const alreadyLogged = objectError != null && context?.loggedPhaseErrors.has(objectError);
    if (!alreadyLogged && claimPhaseRecord()) {
      if (objectError != null) context?.loggedPhaseErrors.add(objectError);
      emit(options?.failureLevel ?? "error", "sync.phase.failed", {
        phase,
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        ...fields,
        ...describeSyncError(error),
      });
    }
    throw error;
  }
}

export function mutationLogFields(mutations: Pick<Mutation, "op" | "table">[]): LogFields {
  const mutationTypes: Record<string, number> = {};
  for (const mutation of mutations) {
    const key = `${mutation.table}.${mutation.op}`;
    mutationTypes[key] = (mutationTypes[key] ?? 0) + 1;
  }
  return { mutationCount: mutations.length, mutationTypes };
}

export async function withSyncRequest<T>(
  request: Request,
  operation: string,
  work: () => Promise<T>,
  statusOf: (result: T) => number | undefined,
): Promise<T> {
  const netlifyRequestId = request.headers.get("x-nf-request-id") ?? undefined;
  const context: RequestLogContext = {
    requestId: netlifyRequestId ?? randomUUID(),
    netlifyRequestId,
    operation,
    method: request.method,
    pathname: new URL(request.url).pathname,
    cold: requestCount++ === 0,
    phaseRecords: 0,
    phaseLimitReported: false,
    loggedPhaseErrors: new WeakSet(),
  };

  return requestLogStorage.run(context, async () => {
    const startedAt = performance.now();
    emit("info", "sync.request.started");

    try {
      const result = await work();
      emit("info", "sync.request.completed", {
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        status: statusOf(result) ?? 200,
      });
      return result;
    } catch (error) {
      emit("error", "sync.request.failed", {
        durationMs: Number((performance.now() - startedAt).toFixed(1)),
        status: error instanceof Response ? error.status : 500,
        ...describeSyncError(error),
      });
      throw error;
    }
  });
}
