import { readCookie } from "~/utils/read-cookie";

/**
 * A readable companion to the real session cookies, holding nothing but when the session expires.
 *
 * The tokens themselves are `httpOnly`, so a route guard cannot look at them — it would have to ask
 * the server, and that round trip is exactly what makes navigation feel slow and makes the app
 * unopenable offline. This cookie lets the guard decide locally.
 *
 * It carries no authority whatsoever: anyone can forge it, and all it buys them is rendering a
 * shell with no data in it. Every server function still proves the caller from the signed access
 * cookie.
 */
export const SESSION_HINT_COOKIE = "session_hint";

export function hasLiveSessionHint(): boolean {
  const expiresAt = Number(readCookie(SESSION_HINT_COOKIE));
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}
