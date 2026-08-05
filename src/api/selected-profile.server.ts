import { getCookie } from "@tanstack/react-start/server";
import { SELECTED_PROFILE_COOKIE, parseSelectedProfileId } from "~/modules/profile/profileCookie";

/**
 * Reads the selected profile straight from the request cookie. Only safe to call from inside a
 * server function's `.handler(...)` (or another `.server.ts` module) — this file is stripped
 * from the client bundle, same as `getDb.server.ts`.
 */
export function getSelectedProfileIdFromCookie(): number | null {
  return parseSelectedProfileId(getCookie(SELECTED_PROFILE_COOKIE));
}
