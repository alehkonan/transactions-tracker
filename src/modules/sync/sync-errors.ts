export type SyncErrorCode =
  | "UNAUTHORIZED"
  | "REPLICA_OWNER_MISMATCH"
  | "SYNC_PROTOCOL_UNSUPPORTED"
  | "INVALID_SYNC_REQUEST"
  | "MUTATION_INTENT_MISMATCH"
  | "UNKNOWN_SYNC_ERROR";

export class SyncResponseError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SyncResponseError";
  }
}

const knownCodes = new Set<SyncErrorCode>([
  "REPLICA_OWNER_MISMATCH",
  "SYNC_PROTOCOL_UNSUPPORTED",
  "INVALID_SYNC_REQUEST",
  "MUTATION_INTENT_MISMATCH",
]);

/** Preserves the machine-readable server reason instead of collapsing every permanent failure to 409. */
export function isTerminalSyncError(error: SyncResponseError): boolean {
  return (
    error.code === "REPLICA_OWNER_MISMATCH" ||
    error.code === "SYNC_PROTOCOL_UNSUPPORTED" ||
    error.code === "INVALID_SYNC_REQUEST" ||
    error.code === "MUTATION_INTENT_MISMATCH"
  );
}

export async function readSyncResponseError(response: Response): Promise<SyncResponseError> {
  if (response.status === 401) {
    return new SyncResponseError("UNAUTHORIZED", response.status, "Authentication is required.");
  }

  let body: { code?: unknown; error?: unknown } | null = null;
  try {
    body = (await response.clone().json()) as { code?: unknown; error?: unknown };
  } catch {
    // Non-JSON infrastructure errors remain distinguishable by status and retry policy.
  }

  const code =
    typeof body?.code === "string" && knownCodes.has(body.code as SyncErrorCode)
      ? (body.code as SyncErrorCode)
      : "UNKNOWN_SYNC_ERROR";
  const message =
    typeof body?.error === "string"
      ? body.error
      : `The server rejected the sync request (${response.status}).`;

  return new SyncResponseError(code, response.status, message);
}
