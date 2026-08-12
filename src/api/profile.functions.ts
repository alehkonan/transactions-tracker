import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/get-db.server";
import { profilesTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";
import { setSelectedProfileCookie } from "./selected-profile.server";

/**
 * Records the caller's profile choice, having first proven they own it. That check is why this is
 * a mutation rather than something the client can set for itself: the resulting cookie is signed,
 * so every request afterwards trusts the id without asking the database again.
 *
 * Not a data endpoint, which is why it survives the move to `pushChanges`: creating a profile is a
 * client mutation now (see `modules/profile/profile-mutations.ts`), but only the server can sign a
 * cookie, so choosing one still has to come here.
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
