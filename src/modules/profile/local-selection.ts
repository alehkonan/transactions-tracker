import { selectLocalProfile } from "~/modules/sync/idb";
import { useSyncStore } from "~/modules/sync/useSyncStore";

/** Reads the reactive, replica-scoped profile selection. */
export function useSelectedProfileId(): string | null {
  return useSyncStore((state) => state.selectedProfileId);
}

/** Persists and publishes a local profile selection after confirming it is a live local row. */
export async function selectProfileLocally(profileId: string | null): Promise<void> {
  const replicaContext = useSyncStore.getState().replicaContext;
  if (replicaContext == null) return;

  await selectLocalProfile(replicaContext, profileId);
  useSyncStore.setState({ selectedProfileId: profileId });
}
