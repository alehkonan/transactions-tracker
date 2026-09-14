/* eslint-disable no-await-in-loop -- pages and recovery steps must run sequentially. */

import { isCursorStale } from "./integrity";
import type { OutboxDrainOutcome } from "./outbox-acceptance";
import type { PullChangesResult, SyncCursors, SyncedRow, SyncedTable } from "./sync-types";

const MAX_PAGES_PER_PULL = 200;
const REFERENCE_TABLES: SyncedTable[] = ["profiles", "accounts", "categories"];

export type SyncRunMode = "normal" | "resync";
type SyncRunPhase = "push" | "pull";

export type PullDeliveryResult =
  | { kind: "accepted"; result: PullChangesResult }
  | { kind: "unauthorized"; error?: unknown }
  | { kind: "terminal"; error: unknown }
  | { kind: "retryable"; error: unknown };

export type SyncRunOutcome =
  | { kind: "completed"; changedRows: number; pushed: number; replaced: boolean }
  | { kind: "unauthorized"; phase: SyncRunPhase; pushed: number; error?: unknown }
  | { kind: "terminal"; phase: SyncRunPhase; pushed: number; error: unknown }
  | { kind: "retryable"; phase: SyncRunPhase; pushed: number; error: unknown }
  | { kind: "blocked"; reason: "queued-writes" }
  | { kind: "didNotConverge"; pages: number; pushed: number };

export type SyncRunPage = {
  page: number;
  result: PullChangesResult;
  changedRows: number;
  referenceTablesReady: boolean;
};

export type SyncRunDependencies = {
  remote: {
    pull(cursors: SyncCursors | undefined, withCounts: boolean): Promise<PullDeliveryResult>;
  };
  replica: {
    readCursors(): Promise<SyncCursors | undefined>;
    hasQueuedWrites(): Promise<boolean>;
    captureFullReplacement(): Promise<{ localRevision: number }>;
    replaceFullSnapshot(snapshot: FullReplacementSnapshot): Promise<void>;
    commitPulledPage(result: PullChangesResult): Promise<void>;
  };
  push: {
    drain(): Promise<OutboxDrainOutcome>;
  };
  onPage?(page: SyncRunPage): Promise<void> | void;
  maxPages?: number;
};

function changedRows(result: PullChangesResult): number {
  return Object.values(result.rows).reduce((total, rows) => total + rows.length, 0);
}

type FullReplacementSnapshot = {
  rows: PullChangesResult["rows"];
  cursors: SyncCursors;
  colors: PullChangesResult["colors"];
  usdRates: PullChangesResult["usdRates"];
  localRevision: number;
};

function stageFullPage(
  staged: FullReplacementSnapshot,
  result: PullChangesResult,
): FullReplacementSnapshot {
  const rows = {} as FullReplacementSnapshot["rows"];
  for (const table of Object.keys(staged.rows) as SyncedTable[]) {
    const byId = new Map((staged.rows[table] as SyncedRow[]).map((row) => [row.id, row]));
    for (const row of result.rows[table] as SyncedRow[]) {
      if (row.deletedAt) byId.delete(row.id);
      else byId.set(row.id, row);
    }
    rows[table] = [...byId.values()] as never;
  }

  return {
    rows,
    cursors: result.nextCursors,
    colors: result.colors,
    usdRates: result.usdRates,
    localRevision: staged.localRevision,
  };
}

function retryable(phase: SyncRunPhase, pushed: number, error: unknown): SyncRunOutcome {
  return { kind: "retryable", phase, pushed, error };
}

/**
 * Runs one push-first or full-repull sync, returning facts instead of mutating browser state.
 *
 * The remote, replica, and push dependencies are adapters. The implementation owns ordering,
 * pagination, stale-copy recovery, convergence limits, and the meaning of a successful run.
 */
export async function runSync(
  mode: SyncRunMode,
  dependencies: SyncRunDependencies,
): Promise<SyncRunOutcome> {
  const maxPages = dependencies.maxPages ?? MAX_PAGES_PER_PULL;
  let pushed = 0;
  let replacing = mode === "resync";
  let replacement: FullReplacementSnapshot | undefined;

  if (mode === "resync") {
    try {
      if (await dependencies.replica.hasQueuedWrites())
        return { kind: "blocked", reason: "queued-writes" };
    } catch (error) {
      return retryable("pull", pushed, error);
    }
  } else {
    let hasQueuedWrites: boolean;
    try {
      hasQueuedWrites = await dependencies.replica.hasQueuedWrites();
    } catch (error) {
      return retryable("push", pushed, error);
    }

    if (hasQueuedWrites) {
      try {
        const outcome = await dependencies.push.drain();
        if (outcome.kind === "unauthorized") {
          return { kind: "unauthorized", phase: "push", pushed, error: outcome.error };
        }
        if (outcome.kind === "terminal") {
          return { kind: "terminal", phase: "push", pushed, error: outcome.error };
        }
        if (outcome.kind === "retryable") return retryable("push", pushed, outcome.error);
        pushed = outcome.accepted;
      } catch (error) {
        return retryable("push", pushed, error);
      }
    }
  }

  let cursors: SyncCursors | undefined;
  try {
    cursors = await dependencies.replica.readCursors();
    if (
      mode === "normal" &&
      isCursorStale(cursors) &&
      !(await dependencies.replica.hasQueuedWrites())
    ) {
      replacing = true;
      cursors = undefined;
    }
    if (replacing) {
      const { localRevision } = await dependencies.replica.captureFullReplacement();
      replacement = {
        rows: { profiles: [], accounts: [], categories: [], transactions: [] },
        cursors: {},
        colors: [],
        usdRates: null,
        localRevision,
      };
    }
  } catch (error) {
    return retryable("pull", pushed, error);
  }

  let changed = 0;
  for (let page = 0; page < maxPages; page++) {
    let delivery: PullDeliveryResult;
    try {
      delivery = await dependencies.remote.pull(cursors, page === 0);
    } catch (error) {
      return retryable("pull", pushed, error);
    }
    if (delivery.kind === "unauthorized") {
      return { kind: "unauthorized", phase: "pull", pushed, error: delivery.error };
    }
    if (delivery.kind === "terminal") {
      return { kind: "terminal", phase: "pull", pushed, error: delivery.error };
    }
    if (delivery.kind === "retryable") return retryable("pull", pushed, delivery.error);

    const result = delivery.result;
    cursors = result.nextCursors;
    const pageChanged = changedRows(result);
    changed += pageChanged;

    try {
      if (replacement) {
        replacement = stageFullPage(replacement, result);
      } else {
        await dependencies.replica.commitPulledPage(result);
        await dependencies.onPage?.({
          page,
          result,
          changedRows: pageChanged,
          referenceTablesReady: REFERENCE_TABLES.every((table) => !result.pending.includes(table)),
        });
      }
    } catch (error) {
      return retryable("pull", pushed, error);
    }

    if (result.pending.length === 0) {
      try {
        if (replacement) await dependencies.replica.replaceFullSnapshot(replacement);
      } catch (error) {
        return retryable("pull", pushed, error);
      }
      return { kind: "completed", changedRows: changed, pushed, replaced: replacement != null };
    }
  }

  return { kind: "didNotConverge", pages: maxPages, pushed };
}
