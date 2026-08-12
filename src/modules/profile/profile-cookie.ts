import { readCookie } from "~/utils/read-cookie";

/**
 * The selected profile, signed and `httpOnly`. Ownership is proven once when the profile is chosen
 * (see `selectProfile`), so every request afterwards can trust the id without re-checking it
 * against the database — the signature is what makes the cookie's own claim about `userId`
 * unforgeable.
 */
export const SELECTED_PROFILE_COOKIE = "selected_profile";

export const SELECTED_PROFILE_TTL_SECONDS = 60 * 60 * 24 * 365;

export type SelectedProfilePayload = {
  profileId: string;
  /** Whose selection this is, so the cookie is inert if a different user signs in on this browser. */
  userId: number;
};

/** Readable counterpart of the signed cookie, for route guards. See `SESSION_HINT_COOKIE`. */
export const PROFILE_HINT_COOKIE = "profile_hint";

export function hasSelectedProfileHint(): boolean {
  return Boolean(readCookie(PROFILE_HINT_COOKIE));
}

/**
 * Which profile the client should be showing, or `null` when none is selected.
 *
 * Carries no authority — it decides which of the rows already in the store are on screen, nothing
 * more. Every server function resolves the selection from the signed cookie for itself, so a
 * tampered hint can only ever mean an empty page.
 */
export function readSelectedProfileId(): string | null {
  return readCookie(PROFILE_HINT_COOKIE) ?? null;
}
