import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/get-db.server";
import { profilesTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";
import { setSelectedProfileCookie } from "./selected-profile.server";

/**
 * Compatibility endpoint for pre-local-first clients that still persist profile selection in a
 * signed cookie. Current clients select profiles in replica-scoped IndexedDB metadata and never call
 * this function. Remove it only after the production client/worker cutover gate is complete.
 */
export const selectProfile = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.object({ profileId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const [profile] = await getDb()
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(and(eq(profilesTable.id, data.profileId), eq(profilesTable.userId, context.user.id)));

    if (!profile) throw new Response("No such profile.", { status: 404 });

    setSelectedProfileCookie({ profileId: profile.id, userId: context.user.id });
  });
