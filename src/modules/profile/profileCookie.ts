export const SELECTED_PROFILE_COOKIE = "selected_profile";

/** Unwraps the zustand-persist envelope (`{state:{selectedProfileId},version}`) stored in the cookie. */
export function parseSelectedProfileId(raw: string | undefined): number | null {
  if (!raw) return null;

  try {
    const id = JSON.parse(raw)?.state?.selectedProfileId;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}
