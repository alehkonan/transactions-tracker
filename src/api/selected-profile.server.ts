import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import {
  PROFILE_HINT_COOKIE,
  SELECTED_PROFILE_COOKIE,
  SELECTED_PROFILE_TTL_SECONDS,
  type SelectedProfilePayload,
} from "~/modules/profile/profile-cookie";
import { signCookieValue, verifyCookieValue } from "./signed-cookie.server";

/**
 * Resolves the cookie-selected profile, or `null` when nothing is selected.
 *
 * The cookie is signed, so the id in it is one this server put there after checking ownership (see
 * `selectProfile`) rather than a client-controlled request to look at a profile — which is what
 * lets this run without a query. It is still matched against `userId`: a cookie left behind by a
 * previous user on the same browser is genuinely signed, just not theirs to use.
 *
 * Only safe to call from inside a server function's `.handler(...)` (or another `.server.ts`
 * module) — this file is stripped from the client bundle, same as `getDb.server.ts`.
 */
export function getSelectedProfileIdFromCookie(userId: number): string | null {
  const raw = getCookie(SELECTED_PROFILE_COOKIE);
  const selection = verifyCookieValue<SelectedProfilePayload>(raw);
  // The type check is not paranoia about a payload this server signed itself: cookies minted
  // before profiles were re-keyed to UUIDs carry a number, and handing one to a `uuid` column
  // fails the query rather than simply matching nothing. Treated as no selection, so the browser
  // is sent back to `/profile` to pick again.
  if (selection && typeof selection.profileId === "string" && selection.userId === userId) {
    return selection.profileId;
  }

  // The readable hint has to go with it. It outlives the cookie it stands for whenever the
  // signature stops verifying — a rotated `AUTH_SECRET`, or somebody else signing in on this
  // browser — and on its own it convinces the root guard a profile is selected, landing the user
  // on a profile-scoped page that resolves to nothing with no route back to `/profile`.
  if (raw != null || getCookie(PROFILE_HINT_COOKIE) != null) clearSelectedProfileCookies();

  return null;
}

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
