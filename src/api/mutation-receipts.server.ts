import { createHash } from "node:crypto";
import type { Mutation } from "~/modules/sync/sync-types";

const MUTATION_INTENT_MISMATCH = "MUTATION_INTENT_MISMATCH";

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Fingerprints every operation-defining field after transport validation and coercion. */
export function fingerprintMutation(mutation: Mutation): string {
  return createHash("sha256").update(stableJson(mutation)).digest("hex");
}

export class MutationIntentMismatchError extends Error {
  readonly code = MUTATION_INTENT_MISMATCH;

  constructor(readonly mutationId: string) {
    super("A previously accepted mutation id was reused with different content.");
    this.name = "MutationIntentMismatchError";
  }
}

/** Maps a receipt identity mismatch to the same terminal protocol response for both transports. */
export function mutationIntentMismatchResponse(error: unknown): Response | null {
  if (!(error instanceof MutationIntentMismatchError)) return null;

  return Response.json(
    {
      code: error.code,
      error: error.message,
      mutationId: error.mutationId,
    },
    { status: 409 },
  );
}
