import { useRef } from "react";
import { useSyncStore } from "./useSyncStore";
import type { ReplicaContext } from "./replica-identity";

/**
 * Binds an interactive form to the replica that was visible when it opened.
 * A replacement remounts the workspace, but this extra fence makes an already captured submit
 * fail closed instead of borrowing the replacement's context.
 */
export function useReplicaBinding(): ReplicaContext | null {
  const visibleContext = useSyncStore((state) => state.replicaContext);
  const binding = useRef<ReplicaContext | null>(null);

  if (binding.current == null && visibleContext != null) binding.current = visibleContext;
  return binding.current;
}
