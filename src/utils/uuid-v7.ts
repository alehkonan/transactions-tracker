/**
 * Mints a UUIDv7 — the current millisecond in the leading 48 bits, random the rest of the way.
 *
 * Every synced row is keyed by a client-minted id, which is what lets a device that is offline
 * create a record *and* the records pointing at it without a temporary id and a round of foreign-key
 * rewriting on push (see `docs/offline-first-sync.md`). Version 7 rather than `crypto.randomUUID()`'s
 * version 4 because the leading timestamp keeps consecutive inserts local in the primary key's btree
 * instead of scattering them across it.
 *
 * Hand-rolled: this is the whole of it, and the alternative is a dependency. Nothing depends on the
 * ordering being exact — rows are ordered by `updatedAt`, with the id only breaking ties — so
 * repeated calls within one millisecond needing no monotonic counter is fine.
 */
export function uuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const timestamp = Date.now();

  // Big-endian milliseconds across the first six bytes. Assigning to a `Uint8Array` truncates and
  // takes the low byte, so each shift only has to move the byte wanted into place.
  for (let i = 0; i < 6; i++) bytes[i] = timestamp / 2 ** (8 * (5 - i));

  bytes[6] = 0b0111_0000 | (bytes[6] & 0b0000_1111); // version 7
  bytes[8] = 0b1000_0000 | (bytes[8] & 0b0011_1111); // RFC 9562 variant

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
