import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { executePush } from "~/api/push-execution.server";
import { resolveSession } from "~/api/session.server";
import { pushChangesSchema } from "~/api/sync-schemas";

/**
 * Plain HTTP twin of the page's `pushChanges` RPC. The service worker cannot invoke a server
 * function, but it must use the exact same authenticated, atomic mutation path.
 */
export const Route = createFileRoute("/api/push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await resolveSession();
        if (!user) return new Response("Unauthorized", { status: 401 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
        }

        const parsed = pushChangesSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
        }

        return Response.json(await executePush(user.id, parsed.data.mutations));
      },
    },
  },
});
