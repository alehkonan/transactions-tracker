/**
 * The replicated tables, in parent-first order.
 *
 * Pulls and pushes process parents before children so a batch can establish the rows referenced by
 * later mutations. This module intentionally has no imports: the standalone tombstone GC imports it
 * without pulling in the application's database or bundler graph.
 */
export const SYNCED_TABLES = ["profiles", "accounts", "categories", "transactions"] as const;

/**
 * The same tables in child-first order for tombstone collection.
 *
 * Profiles and accounts cascade on a real delete. Sweeping children first keeps each table's count
 * meaningful and avoids a parent delete removing child tombstones before their own sweep runs.
 */
export const SWEPT_TABLES = ["transactions", "categories", "accounts", "profiles"] as const;

/**
 * A local cursor older than this is discarded and the client pulls a fresh copy. It stays below the
 * tombstone retention window; the two clocks differ because pulls overlap and the GC runs separately.
 */
export const STALE_CURSOR_AFTER_DAYS = 60;

/** Tombstones must outlive the oldest cursor a client is allowed to resume. */
export const RETENTION_DAYS = 90;
