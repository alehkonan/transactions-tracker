import { deleteCookie, setCookie } from "@tanstack/react-start/server";
import {
  PROFILE_HINT_COOKIE,
  SELECTED_PROFILE_COOKIE,
  SELECTED_PROFILE_TTL_SECONDS,
  type SelectedProfilePayload,
} from "~/modules/profile/profile-cookie";
import { signCookieValue } from "./signed-cookie.server";

/**
 * Legacy profile-selection cookies retained for pre-local-first clients during production cutover.
 * Current clients use replica-scoped IndexedDB metadata; these cookies do not control local access
 * or sync authorization. Keep clearing both halves with session changes until the compatibility
 * endpoint is removed.
 *
 * Only safe to call from inside a server function's `.handler(...)` (or another `.server.ts`
 * module) — this file is stripped from the client bundle, same as `get-db.server.ts`.
 */

/** Forgets this browser's selection — both halves of it, which always travel together. */
export function clearSelectedProfileCookies(): void {
  deleteCookie(SELECTED_PROFILE_COOKIE, { path: "/" });
  deleteCookie(PROFILE_HINT_COOKIE, { path: "/" });
}

/**
 * Records `profileId` as this browser's selection. The caller is responsible for having proven
 * that `userId` owns it — that check happens once, here, instead of on every request afterwards.
 */
export function setSelectedProfileCookie(payload: SelectedProfilePayload): void {
  const shared = {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SELECTED_PROFILE_TTL_SECONDS,
  } as const;

  setCookie(SELECTED_PROFILE_COOKIE, signCookieValue(payload), { ...shared, httpOnly: true });
  // Readable counterpart, so the root route's guard can tell a profile has been chosen without
  // asking the server. See `SESSION_HINT_COOKIE`.
  setCookie(PROFILE_HINT_COOKIE, payload.profileId, { ...shared, httpOnly: false });
}
