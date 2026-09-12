import { createFileRoute } from "@tanstack/react-router";
import { mutationIntentMismatchResponse } from "~/api/mutation-receipts.server";
import { executePush } from "~/api/push-execution.server";
import { resolveSession } from "~/api/session.server";
import {
  logSyncEvent,
  mutationLogFields,
  retryableSyncResponse,
  withSyncPhase,
  withSyncRequest,
} from "~/api/sync-observability.server";
import { validateSyncRequest } from "~/api/sync-protocol.server";
import { pushChangesSchema } from "~/api/sync-schemas";

/**
 * Plain HTTP twin of the page's `pushChanges` RPC. The service worker cannot invoke a server
 * function, but it must use the exact same authenticated, atomic mutation path.
 */
export const Route = createFileRoute("/api/push")({
  server: {
    handlers: {
      POST: ({ request }) =>
        withSyncRequest(
          request,
          "workerPush",
          async () => {
            logSyncEvent("sync.push.http_request", {
              contentLength: request.headers.get("content-length") ?? undefined,
            });

            const user = await withSyncPhase("auth.resolve_session", resolveSession);
            if (!user) return new Response("Unauthorized", { status: 401 });

            let body: unknown;
            try {
              body = await withSyncPhase("push.parse_body", () => request.json());
            } catch {
              return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
            }

            try {
              const parsed = validateSyncRequest(pushChangesSchema, body, user.id);
              logSyncEvent("sync.push.batch", mutationLogFields(parsed.mutations));

              const result = await withSyncPhase(
                "push.execute",
                () => executePush(user.id, parsed.mutations),
                { mutationCount: parsed.mutations.length },
                (pushResult) => ({
                  appliedCount: pushResult.applied.length,
                  conflictCount: pushResult.conflicts.length,
                }),
              );
              return Response.json(result);
            } catch (error) {
              if (error instanceof Response) return error;
              const response =
                mutationIntentMismatchResponse(error) ?? retryableSyncResponse(error);
              if (response) return response;
              throw error;
            }
          },
          (response) => response.status,
        ),
    },
  },
});
