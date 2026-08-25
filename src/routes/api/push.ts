import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applyMutations } from "~/api/apply-mutations.server";
import { readCanonicalRows, readColors } from "~/api/push.server";
import { resolveSession } from "~/api/session.server";
import { pushChangesSchema } from "~/api/sync-schemas";
import { getDb } from "~/database/get-db.server";

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

        const db = getDb();
        const { conflicts, touched } =
          parsed.data.mutations.length === 0
            ? { conflicts: [], touched: null }
            : await db.transaction((tx) => applyMutations(tx, user.id, parsed.data.mutations));

        const [canonicalRows, colors] = await Promise.all([
          touched == null
            ? { profiles: [], accounts: [], categories: [], transactions: [] }
            : readCanonicalRows(db, touched),
          readColors(db),
        ]);

        return Response.json({
          applied: parsed.data.mutations.map((mutation) => mutation.mutationId),
          canonicalRows,
          conflicts,
          colors,
        });
      },
    },
  },
});
