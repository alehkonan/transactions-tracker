import { z } from "zod";
import { SYNC_PROTOCOL_VERSION } from "~/modules/sync/sync-types";
import type { ReplicaSyncContext } from "~/modules/sync/sync-types";

const SYNC_PROTOCOL_UNSUPPORTED = "SYNC_PROTOCOL_UNSUPPORTED";
const INVALID_SYNC_REQUEST = "INVALID_SYNC_REQUEST";
export const REPLICA_OWNER_MISMATCH = "REPLICA_OWNER_MISMATCH";

function protocolVersionOf(value: unknown): unknown {
  if (typeof value !== "object" || value == null) return undefined;
  return Reflect.get(value, "protocolVersion");
}

function protocolError(): Response {
  return Response.json(
    {
      code: SYNC_PROTOCOL_UNSUPPORTED,
      error: "This client sync protocol is not supported.",
      supportedProtocolVersion: SYNC_PROTOCOL_VERSION,
    },
    { status: 426 },
  );
}

function invalidRequestError(error: z.ZodError): Response {
  return Response.json(
    { code: INVALID_SYNC_REQUEST, error: z.treeifyError(error) },
    { status: 400 },
  );
}

function ownerMismatchError(): Response {
  return Response.json(
    {
      code: REPLICA_OWNER_MISMATCH,
      error: "The authenticated user does not own this local replica.",
    },
    { status: 409 },
  );
}

/** Validates and authorizes a sync envelope before any domain read, write, or receipt claim. */
export function validateSyncRequest<Input extends ReplicaSyncContext>(
  schema: z.ZodType<Input>,
  value: unknown,
  actualOwnerUserId: number,
): Input {
  if (protocolVersionOf(value) !== SYNC_PROTOCOL_VERSION) throw protocolError();

  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidRequestError(parsed.error);
  if (parsed.data.expectedOwnerUserId !== actualOwnerUserId) throw ownerMismatchError();

  return parsed.data;
}
