import { readCookie } from "~/utils/read-cookie";

/**
 * A readable companion to the real session cookies, holding when the session expires and whose it
 * is.
 *
 * The tokens themselves are `httpOnly`, so a route guard cannot look at them — it would have to ask
 * the server, and that round trip is exactly what makes navigation feel slow and makes the app
 * unopenable offline. This cookie lets the guard decide locally, and lets the settings page name the
 * signed-in user without a request.
 *
 * It carries no authority whatsoever: anyone can forge it, and all it buys them is rendering a shell
 * with their own made-up name in it. Every server function still proves the caller from the signed
 * access cookie. Nothing secret goes in here — a username is already on screen throughout the app.
 */
export const SESSION_HINT_COOKIE = "session_hint";

export type SessionHint = {
  /** Epoch milliseconds, mirroring the refresh token's deadline. */
  exp: number;
  username: string | null;
};

export function encodeSessionHint(hint: SessionHint): string {
  return JSON.stringify(hint);
}

/**
 * Reads the hint, tolerating the bare-timestamp form it used to have: a browser holding one of those
 * has a perfectly live session, and treating it as absent would sign the user out for no reason.
 */
export function readSessionHint(): SessionHint | null {
  const raw = readCookie(SESSION_HINT_COOKIE);
  if (!raw) return null;

  const legacyExpiresAt = Number(raw);
  if (Number.isFinite(legacyExpiresAt) && raw.trim() !== "") {
    return { exp: legacyExpiresAt, username: null };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SessionHint>;
    if (typeof parsed.exp !== "number") return null;
    return {
      exp: parsed.exp,
      username: typeof parsed.username === "string" ? parsed.username : null,
    };
  } catch {
    return null;
  }
}

export function hasLiveSessionHint(): boolean {
  const hint = readSessionHint();
  return hint != null && hint.exp > Date.now();
}
