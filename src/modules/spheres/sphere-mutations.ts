import { commit, newRow } from "~/modules/sync/mutations";
import type { ReplicaContext } from "~/modules/sync/replica-identity";
import type { SpherePayload, SyncedSphere } from "~/modules/sync/sync-types";

export async function createSphere(
  profileId: string,
  name: string,
  type: "FUNDS" | "CAPITAL",
  context: ReplicaContext,
): Promise<string> {
  const payload: SpherePayload = { profileId, name: name.trim(), type, archived: false };
  const row = newRow({ ...payload, hasHistory: false });
  await commit([{ op: "upsert", table: "spheres", row, payload }], context);
  return row.id;
}

export function updateSphere(
  sphere: SyncedSphere,
  input: { name: string; archived: boolean },
  context: ReplicaContext,
): Promise<void> {
  const payload: SpherePayload = {
    profileId: sphere.profileId,
    type: sphere.type,
    name: input.name.trim(),
    archived: input.archived,
  };
  return commit(
    [{ op: "upsert", table: "spheres", row: { ...sphere, ...payload }, payload }],
    context,
  );
}

export function deleteSphere(sphere: SyncedSphere, context: ReplicaContext): Promise<void> {
  return commit([{ op: "delete", table: "spheres", row: sphere }], context);
}
