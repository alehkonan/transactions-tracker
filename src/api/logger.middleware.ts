import { performance } from "node:perf_hooks";
import { createMiddleware } from "@tanstack/react-start";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const METHOD_COLORS: Record<string, string> = {
  GET: "\x1b[36m", // cyan
  POST: "\x1b[32m", // green
  PUT: "\x1b[33m", // yellow
  PATCH: "\x1b[33m", // yellow
  DELETE: "\x1b[31m", // red
};

function colorForStatus(status: number): string {
  if (status >= 500) return "\x1b[31m"; // red
  if (status >= 400) return "\x1b[33m"; // yellow
  if (status >= 300) return "\x1b[36m"; // cyan
  return "\x1b[32m"; // green
}

function colorForDuration(ms: number): string {
  if (ms >= 500) return "\x1b[31m"; // red
  if (ms >= 100) return "\x1b[33m"; // yellow
  return "\x1b[32m"; // green
}

function pad(n: number, length = 2): string {
  return String(n).padStart(length, "0");
}

/** Formats a `Date` as a local `HH:MM:SS.mmm` timestamp. */
function formatTimestamp(date: Date): string {
  return (
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}`
  );
}

/**
 * Logs every server function call: method, name, response status (when known), and how long it
 * took.
 *
 * TanStack Start's middleware `.server()` callbacks are isomorphic — this also runs on the
 * client as part of the RPC call path (`window` exists there), and separately, `next()`'s
 * `response` is only populated for actual HTTP round-trips, not for server functions invoked
 * directly in-process (e.g. from a loader during SSR). So: skip entirely on the client, and on
 * the server always log — status is shown only when we actually have one.
 */
export const loggerMiddleware = createMiddleware().server(
  async ({ next, request, pathname, serverFnMeta }) => {
    const startedAt = performance.now();
    const startedAtDate = new Date();
    const result = await next();
    if (typeof window !== "undefined") return result;

    const durationMs = performance.now() - startedAt;
    const methodColor = METHOD_COLORS[request.method] ?? "\x1b[37m";
    const label = serverFnMeta?.name ?? pathname;
    const status = result.response?.status;

    console.log(
      `${DIM}${formatTimestamp(startedAtDate)}${RESET} ` +
        `${methodColor}${BOLD}${request.method.padEnd(6)}${RESET}` +
        `${DIM}${label}${RESET} ` +
        (status != null ? `${colorForStatus(status)}${status}${RESET} ` : "") +
        `${colorForDuration(durationMs)}${durationMs.toFixed(1)}ms${RESET}`,
    );

    return result;
  },
);
