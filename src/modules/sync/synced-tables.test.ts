import { describe, expect, it } from "vitest";
import {
  RETENTION_DAYS,
  STALE_CURSOR_AFTER_DAYS,
  SWEPT_TABLES,
  SYNCED_TABLES,
} from "./synced-tables";

describe("synced table definitions", () => {
  it("keeps the sweep and sync lists in sync", () => {
    expect(SWEPT_TABLES.toSorted()).toEqual(SYNCED_TABLES.toSorted());
  });

  it("sweeps children before parents", () => {
    expect(SWEPT_TABLES).toEqual(SYNCED_TABLES.toReversed());
  });

  it("keeps a safety margin between stale cursors and tombstone retention", () => {
    expect(RETENTION_DAYS - STALE_CURSOR_AFTER_DAYS).toBeGreaterThanOrEqual(15);
  });
});
