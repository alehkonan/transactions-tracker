import { getCookie } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "~/database/get-db.server";
import { profilesTable } from "~/database/tables";
import { SELECTED_PROFILE_COOKIE, parseSelectedProfileId } from "~/modules/profile/profile-cookie";

/**
 * Resolves the cookie-selected profile, but only if `userId` actually owns it.
 *
 * The cookie is client-controlled, so on its own it is a request to look at a profile, not proof
 * of access — anyone could point it at someone else's id. Confirming ownership here means every
 * handler downstream can treat `context.profileId` as already authorized.
 *
 * Only safe to call from inside a server function's `.handler(...)` (or another `.server.ts`
 * module) — this file is stripped from the client bundle, same as `getDb.server.ts`.
 */
export async function getSelectedProfileIdFromCookie(userId: number): Promise<number | null> {
  const profileId = parseSelectedProfileId(getCookie(SELECTED_PROFILE_COOKIE));
  if (profileId === null) return null;

  const [profile] = await getDb()
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(and(eq(profilesTable.id, profileId), eq(profilesTable.userId, userId)));

  return profile?.id ?? null;
}
