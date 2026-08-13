import { describe, expect, it } from "vitest";
import { compareIntegrity, isCursorStale, localIntegrity, tableIntegrity } from "./integrity";
import { STALE_CURSOR_AFTER_DAYS } from "./sync-types";
import type { IntegrityResult, SyncCursors, SyncedRow, SyncedRows } from "./sync-types";

const row = (id: string, updatedAt: string): SyncedRow => ({
  id,
  updatedAt: new Date(updatedAt),
  deletedAt: null,
});

const A = row("0195f3a0-0000-7000-8000-000000000001", "2026-08-01T10:00:00.000Z");
const B = row("0195f3a0-0000-7000-8000-000000000002", "2026-08-01T10:00:00.000Z");
const C = row("0195f3a0-0000-7000-8000-000000000003", "2026-08-02T11:30:00.000Z");

describe("tableIntegrity", () => {
  it("does not depend on the order the rows are held in", () => {
    expect(tableIntegrity([A, B, C])).toEqual(tableIntegrity([C, A, B]));
  });

  it("fingerprints an empty table as zero", () => {
    expect(tableIntegrity([])).toEqual({ count: 0, checksum: "0" });
  });

  it("changes when a row's updatedAt moves", () => {
    const moved = { ...C, updatedAt: new Date("2026-08-02T11:30:00.001Z") };

    expect(tableIntegrity([A, moved]).checksum).not.toBe(tableIntegrity([A, C]).checksum);
  });

  // The whole reason the uuid is folded in: the Phase 1 migration stamped every pre-existing row
  // with an identical `updatedAt`, so a timestamp-only checksum would call these two sets equal.
  it("distinguishes different rows sharing one updatedAt", () => {
    expect(tableIntegrity([A]).checksum).not.toBe(tableIntegrity([B]).checksum);
  });

  it("stays inside signed 64 bits", () => {
    const checksum = BigInt(tableIntegrity([A, B, C]).checksum);

    expect(checksum).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(checksum).toBeLessThan(2n ** 63n);
  });
});

describe("compareIntegrity", () => {
  const rows = (transactions: SyncedRow[]): SyncedRows =>
    ({ profiles: [A], accounts: [B], categories: [], transactions }) as unknown as SyncedRows;

  const local: IntegrityResult = localIntegrity(rows([C]));

  it("reports nothing when both sides agree", () => {
    expect(compareIntegrity(local, localIntegrity(rows([C])))).toEqual([]);
  });

  it("reports the table that is missing a row", () => {
    const diverged = compareIntegrity(localIntegrity(rows([])), local);

    expect(diverged).toHaveLength(1);
    expect(diverged[0]?.table).toBe("transactions");
    expect(diverged[0]?.local.count).toBe(0);
    expect(diverged[0]?.server.count).toBe(1);
  });

  it("reports a table whose count matches but whose rows do not", () => {
    const diverged = compareIntegrity(localIntegrity(rows([A])), local);

    expect(diverged.map((entry) => entry.table)).toEqual(["transactions"]);
  });
});

describe("isCursorStale", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");
  const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

  const cursors = (updatedAt: string): SyncCursors => ({
    profiles: { updatedAt: daysAgo(1), id: null },
    accounts: { updatedAt: daysAgo(1), id: null },
    categories: { updatedAt: daysAgo(1), id: null },
    transactions: { updatedAt, id: null },
  });

  it("treats a copy with no cursor at all as fresh — it has never been pulled", () => {
    expect(isCursorStale(undefined, now)).toBe(false);
    expect(isCursorStale({}, now)).toBe(false);
  });

  it("accepts a cursor inside the window", () => {
    expect(isCursorStale(cursors(daysAgo(STALE_CURSOR_AFTER_DAYS - 1)), now)).toBe(false);
  });

  // One lagging table is enough: the deletions it missed have been swept either way.
  it("rejects a copy whose oldest table cursor is past the window", () => {
    expect(isCursorStale(cursors(daysAgo(STALE_CURSOR_AFTER_DAYS + 1)), now)).toBe(true);
  });

  it("rejects a cursor it cannot read", () => {
    expect(isCursorStale({ transactions: { updatedAt: "not a timestamp", id: null } }, now)).toBe(
      true,
    );
  });
});
