import { STALE_CURSOR_AFTER_DAYS, SYNCED_TABLES } from "./sync-types";
import type {
  IntegrityResult,
  SyncCursors,
  SyncedRow,
  SyncedRows,
  SyncedTable,
  TableIntegrity,
} from "./sync-types";

/**
 * The two questions that can be asked about a local copy without downloading the whole thing again:
 * whether it still matches the server, and whether it is recent enough to be worth asking.
 *
 * Both exist because replication is a chain of assumptions — a cursor that advanced correctly, a
 * page written before it was applied, a pull that left a queued row alone — and nothing else in the
 * sync path would ever notice one of them failing. Neither of these repairs anything: they decide
 * when to throw the local copy away and pull it afresh, which is the only repair there is.
 */

/**
 * One row's contribution to its table's checksum — both halves of its uuid, xor'd together and with
 * its `updatedAt` in epoch milliseconds.
 *
 * Has to agree exactly with `rowDigest` in `sync.functions.ts`, which is why both sides settle for
 * milliseconds: postgres keeps microseconds, a `Date` does not, and the driver truncates rather
 * than rounds on the way here.
 *
 * Folding the uuid in is what makes this more than a timestamp — the Phase 1 migration gave every
 * pre-existing row an identical `updatedAt`, so a copy holding one of those rows in place of another
 * would pass a timestamp-only checksum. *Both* halves, because a v7 uuid's leading 64 bits are 48
 * bits of millisecond and 12 of randomness: two rows minted in the same millisecond — which a CSV
 * import does thousands of times — would otherwise collide once every few thousand rows.
 */
function rowDigest(row: SyncedRow): bigint {
  const hex = row.id.replaceAll("-", "");

  return (
    BigInt(`0x${hex.slice(0, 16)}`) ^
    BigInt(`0x${hex.slice(16, 32)}`) ^
    BigInt(row.updatedAt.getTime())
  );
}

/**
 * Fingerprints one in-memory table.
 *
 * Combined with xor so the result does not depend on the order the rows happen to sit in — the
 * store's arrays are in whatever order pages and merges left them, and the server's are in index
 * order.
 */
export function tableIntegrity(rows: SyncedRow[]): TableIntegrity {
  let checksum = 0n;
  for (const row of rows) checksum ^= rowDigest(row);

  // Wrapped to signed 64-bit, which is what `bit_xor` over `bigint` hands back on the other side.
  return { count: rows.length, checksum: BigInt.asIntN(64, checksum).toString() };
}

/** Fingerprints the whole working set, in the shape `checkIntegrity` answers in. */
export function localIntegrity(rows: SyncedRows): IntegrityResult {
  return {
    profiles: tableIntegrity(rows.profiles),
    accounts: tableIntegrity(rows.accounts),
    categories: tableIntegrity(rows.categories),
    transactions: tableIntegrity(rows.transactions),
  };
}

/** A table whose local copy is not what the server says it should be. */
export type IntegrityDivergence = {
  table: SyncedTable;
  local: TableIntegrity;
  server: TableIntegrity;
};

/**
 * The tables that disagree.
 *
 * Both halves matter: a count on its own misses an edit that never arrived, and a checksum on its
 * own misses a row held twice — which memory cannot do, but a comparison worth trusting should not
 * depend on that.
 */
export function compareIntegrity(
  local: IntegrityResult,
  server: IntegrityResult,
): IntegrityDivergence[] {
  return SYNCED_TABLES.filter(
    (table) =>
      local[table].count !== server[table].count ||
      local[table].checksum !== server[table].checksum,
  ).map((table) => ({ table, local: local[table], server: server[table] }));
}

/**
 * Whether this copy is too far behind to be caught up incrementally.
 *
 * A deletion is only visible to a delta pull while its tombstone exists, and the sweep
 * (`netlify/functions/tombstone-gc.mts`) eventually removes it. A device that was away longer than
 * that would pull every edit and miss every deletion, and — because a pull only ever adds — would
 * keep the deleted rows forever without anything looking wrong. So a cursor this old is not resumed
 * from; the local copy is dropped and pulled again from nothing.
 *
 * Measured against the *oldest* table cursor, since one lagging table is enough to have missed a
 * deletion, and a missing cursor means that table has never been pulled at all — which is not stale,
 * just empty.
 */
export function isCursorStale(cursors: SyncCursors | undefined, now = Date.now()): boolean {
  if (!cursors) return false;

  const positions = SYNCED_TABLES.map((table) => cursors[table]).filter((cursor) => cursor != null);
  if (positions.length === 0) return false;

  const oldest = Math.min(...positions.map((cursor) => Date.parse(cursor.updatedAt)));
  // An unparseable cursor is a local copy nothing can be concluded about, which is reason enough.
  if (Number.isNaN(oldest)) return true;

  return now - oldest > STALE_CURSOR_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
