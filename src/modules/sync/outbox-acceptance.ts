/* eslint-disable no-await-in-loop -- batches must drain sequentially to preserve outbox order. */

/** A durable outbox entry ordered by its monotonic sequence number. */
export type SequencedEntry = {
  seq: number;
  mutationId: string;
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
  | { kind: "retryable"; error: unknown };

export type OutboxDrainOutcome =
  | { kind: "drained"; accepted: number }
  | { kind: "unauthorized"; accepted: number; error?: unknown }
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
      if (batch.length < options.batchLimit) {
        return { kind: "drained", accepted: acceptedCount };
      }
    }
  };

  return options.withExclusive ? options.withExclusive(run) : run();
}
