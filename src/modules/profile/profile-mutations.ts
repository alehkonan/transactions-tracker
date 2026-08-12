import { commit, newRow } from "~/modules/sync/mutations";
import { pushNow } from "~/modules/sync/useSyncStore";
import type { ProfilePayload } from "~/modules/sync/sync-types";

/**
 * Creates a profile and waits for it to reach the server.
 *
 * The one mutation in the app that cannot be fire-and-forget: selecting a profile mints a signed
 * cookie, and the server will only sign one for a profile it can see (see `selectProfile`). So the
 * push is awaited here rather than left to the debounce — the alternative is a profile the user
 * has just made and cannot open for another second.
 */
export async function createProfile(name: string): Promise<string> {
  const payload: ProfilePayload = { name };
  // `userId` is the server's to stamp from the session; locally the row simply has no owner yet.
  const row = newRow({ ...payload, userId: null });

  await commit([{ op: "upsert", table: "profiles", row, payload }]);
  await pushNow();

  return row.id;
}
