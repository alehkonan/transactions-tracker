import { createMiddleware } from "@tanstack/react-start";
import { retryableSyncResponse, withSyncRequest } from "./sync-observability.server";

/**
 * Logs every server function call with a start record that survives platform termination, a shared
 * request/isolate identity, and a completion or sanitized failure record.
 *
 * TanStack Start's middleware `.server()` callbacks are isomorphic — this also runs on the
 * client as part of the RPC call path (`window` exists there), and separately, `next()`'s
 * `response` is only populated for actual HTTP round-trips, not for server functions invoked
 * directly in-process (e.g. from a loader during SSR). So: skip entirely on the client, and on
 * the server always log — status is shown only when we actually have one.
 */
export const loggerMiddleware = createMiddleware().server(
  async ({ next, request, pathname, serverFnMeta }) => {
    if (typeof window !== "undefined") return next();

    try {
      return await withSyncRequest(
        request,
        serverFnMeta?.name ?? pathname,
        async () => await next(),
        (result) => (result instanceof Response ? result.status : result.response?.status),
      );
    } catch (error) {
      const response = retryableSyncResponse(error);
      if (response) throw response;
      throw error;
    }
  },
);
