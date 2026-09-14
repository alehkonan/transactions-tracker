/**
 * Legacy selected-profile cookies retained while pre-local-first clients may still be deployed.
 * Current clients keep selection in replica-scoped IndexedDB metadata and give these cookies no
 * authority over local access or synchronization.
 */
export const SELECTED_PROFILE_COOKIE = "selected_profile";

export const SELECTED_PROFILE_TTL_SECONDS = 60 * 60 * 24 * 365;

export type SelectedProfilePayload = {
  profileId: string;
  /** Whose selection this is, so the cookie is inert if a different user signs in on this browser. */
  userId: number;
};

/** Readable counterpart retained only for pre-local-first clients during cutover. */
export const PROFILE_HINT_COOKIE = "profile_hint";
