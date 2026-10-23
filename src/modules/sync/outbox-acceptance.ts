export type OperationMember = {
  mutationId: string;
  operation?: { id: string; mutationIds: string[] };
};

/** An operation's complete, ordered membership travels in every immutable intent. */
export function assertCompleteOperations(
  entries: readonly OperationMember[],
  maximumSize = Infinity,
): void {
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!entry.operation) continue;
    const { id, mutationIds } = entry.operation;
    if (
      seen.has(id) ||
      mutationIds.length === 0 ||
      mutationIds.length > maximumSize ||
      new Set(mutationIds).size !== mutationIds.length ||
      mutationIds.some((mutationId, offset) => {
        const member = entries[index + offset];
        return (
          member?.mutationId !== mutationId ||
          member.operation?.id !== id ||
          member.operation.mutationIds.length !== mutationIds.length ||
          member.operation.mutationIds.some((value, position) => value !== mutationIds[position])
        );
      })
    )
      throw new Error("A financial operation must contain all of its ordered mutations.");
    seen.add(id);
    index += mutationIds.length - 1;
  }
}

/** Selects a prefix without cutting the last operation at a push boundary. */
export function takeOperationBatch<T extends OperationMember>(
  entries: readonly T[],
  limit: number,
): T[] {
  let end = 0;
  while (end < entries.length && end < limit) {
    const size = entries[end].operation?.mutationIds.length ?? 1;
    if (size < 1 || size > limit) throw new Error("A financial operation exceeds the push limit.");
    if (end + size > limit) break;
    if (end + size > entries.length) throw new Error("A queued financial operation is incomplete.");
    const operation = entries.slice(end, end + size);
    assertCompleteOperations(operation);
    end += size;
  }
  return entries.slice(0, end);
}

/** A partial receipt never releases any member of the partially accepted operation. */
export function assertCompleteAcceptance(
  entries: readonly OperationMember[],
  accepted: ReadonlySet<string>,
): void {
  assertCompleteOperations(entries);
  for (const entry of entries) {
    if (!entry.operation) continue;
    const count = entry.operation.mutationIds.filter((id) => accepted.has(id)).length;
    if (count !== 0 && count !== entry.operation.mutationIds.length) {
      throw new Error("The server confirmed only part of a financial operation.");
    }
  }
}

/* eslint-disable no-await-in-loop -- batches must drain sequentially to preserve outbox order. */

/** A durable outbox entry ordered by its monotonic sequence number. */
export type SequencedEntry = {
  seq: number;
  mutationId: string;
  operation?: { id: string; mutationIds: string[] };
};

export type OutboxStorage<
  Entry extends SequencedEntry,
  Result extends { applied: readonly string[] },
> = {
  readBatch(limit: number): Promise<readonly Entry[]>;
  dropEntries(seqs: readonly number[]): Promise<void>;
  settleEntries?(seqs: readonly number[], result: Result): Promise<void>;
};

export type OutboxDeliveryResult<Result extends { applied: readonly string[] }> =
  | { kind: "accepted"; result: Result }
  | { kind: "unauthorized"; error?: unknown }
  | { kind: "terminal"; error: unknown }
  | { kind: "retryable"; error: unknown };

export type OutboxDrainOutcome =
  | { kind: "drained"; accepted: number }
  | { kind: "unauthorized"; accepted: number; error?: unknown }
  | { kind: "terminal"; accepted: number; error: unknown }
  | { kind: "retryable"; accepted: number; error: unknown };

type OutboxAcceptanceOptions<
  Entry extends SequencedEntry,
  Payload,
  Result extends { applied: readonly string[] },
> = {
  storage: OutboxStorage<Entry, Result>;
  batchLimit: number;
  toPayload(entry: Entry): Payload;
  send(payloads: readonly Payload[]): Promise<OutboxDeliveryResult<Result>>;
  onAccepted?(result: Result, entries: readonly Entry[]): Promise<void>;
  withExclusive?<T>(work: () => Promise<T>): Promise<T>;
};

function isAscending(entries: readonly SequencedEntry[]): boolean {
  for (let index = 1; index < entries.length; index++) {
    if (entries[index - 1].seq >= entries[index].seq) return false;
  }
  return true;
}

/**
 * Drains durable outbox entries while keeping ordering and confirmation rules in one place.
 *
 * The module has no browser, IndexedDB, or transport dependencies. Callers provide adapters for those
 * concerns, and only the page adapter supplies `onAccepted` for applying canonical rows to memory.
 */
export async function drainOutbox<
  Entry extends SequencedEntry,
  Payload,
  Result extends { applied: readonly string[] },
>(options: OutboxAcceptanceOptions<Entry, Payload, Result>): Promise<OutboxDrainOutcome> {
  const run = async (): Promise<OutboxDrainOutcome> => {
    let acceptedCount = 0;

    for (;;) {
      const batch = await options.storage.readBatch(options.batchLimit);
      if (batch.length === 0) return { kind: "drained", accepted: acceptedCount };
      if (batch.length > options.batchLimit || !isAscending(batch)) {
        return {
          kind: "retryable",
          accepted: acceptedCount,
          error: new Error("The outbox returned an invalid batch order."),
        };
      }

      const delivery = await options.send(batch.map(options.toPayload));
      if (delivery.kind === "unauthorized") {
        return { kind: "unauthorized", accepted: acceptedCount, error: delivery.error };
      }
      if (delivery.kind === "terminal") {
        return { kind: "terminal", accepted: acceptedCount, error: delivery.error };
      }
      if (delivery.kind === "retryable") {
        return { kind: "retryable", accepted: acceptedCount, error: delivery.error };
      }
      if (!Array.isArray(delivery.result.applied)) {
        return {
          kind: "retryable",
          accepted: acceptedCount,
          error: new Error("The server returned an invalid push receipt."),
        };
      }

      const applied = new Set(delivery.result.applied);
      try {
        assertCompleteAcceptance(batch, applied);
      } catch (error) {
        return { kind: "retryable", accepted: acceptedCount, error };
      }
      const confirmed = batch.filter((entry) => applied.has(entry.mutationId));
      if (confirmed.length === 0) {
        return {
          kind: "retryable",
          accepted: acceptedCount,
          error: new Error("The server confirmed none of the pushed changes."),
        };
      }

      const confirmedSeqs = confirmed.map((entry) => entry.seq);
      if (options.storage.settleEntries) {
        await options.storage.settleEntries(confirmedSeqs, delivery.result);
      } else {
        await options.storage.dropEntries(confirmedSeqs);
      }
      acceptedCount += confirmed.length;
      await options.onAccepted?.(delivery.result, confirmed);

      if (confirmed.length < batch.length) {
        return {
          kind: "retryable",
          accepted: acceptedCount,
          error: new Error("The server confirmed only part of the pushed changes."),
        };
      }
    }
  };

  return options.withExclusive ? options.withExclusive(run) : run();
}
