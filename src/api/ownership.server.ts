import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "~/database/get-db.server";
import { accountsTable, categoriesTable } from "~/database/tables";

/**
 * Ownership checks for record ids that arrive from the client.
 *
 * `profileMiddleware` proves the caller owns the *profile*, but a handler that then trusts an
 * `accountId` or `categoryId` from the request body is still reachable across profiles — and, now
 * that profiles have owners, across users. These assertions close that gap for the mutations that
 * address records by id.
 *
 * A soft-deleted record counts as absent: it is gone from every client, so nothing new may be filed
 * against it.
 *
 * Only safe to call from inside a server function's `.handler(...)`.
 */

function forbidden(): Response {
  return new Response("That record does not belong to the selected profile.", { status: 403 });
}

/** Drops nulls and duplicates so the count comparison below is meaningful. */
function uniqueIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id) => id != null))];
}

/** Throws 403 unless every account id given belongs to `profileId`. */
export async function assertAccountsInProfile(
  profileId: string,
  ids: (string | null | undefined)[],
): Promise<void> {
  const wanted = uniqueIds(ids);
  if (wanted.length === 0) return;

  const owned = await getDb()
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(
      and(
        inArray(accountsTable.id, wanted),
        eq(accountsTable.profileId, profileId),
        isNull(accountsTable.deletedAt),
      ),
    );

  if (owned.length !== wanted.length) throw forbidden();
}

/** Throws 403 unless every category id given belongs to `profileId`. */
export async function assertCategoriesInProfile(
  profileId: string,
  ids: (string | null | undefined)[],
): Promise<void> {
  const wanted = uniqueIds(ids);
  if (wanted.length === 0) return;

  const owned = await getDb()
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(
      and(
        inArray(categoriesTable.id, wanted),
        eq(categoriesTable.profileId, profileId),
        isNull(categoriesTable.deletedAt),
      ),
    );

  if (owned.length !== wanted.length) throw forbidden();
}
