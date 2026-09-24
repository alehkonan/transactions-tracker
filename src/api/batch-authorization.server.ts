import { and, eq, inArray, isNull } from "drizzle-orm";
import { accountsTable, categoriesTable, profilesTable } from "~/database/tables";
import { withSyncPhase } from "./sync-observability.server";
import type { Executor } from "~/database/get-db.server";
import type { Mutation } from "~/modules/sync/sync-types";

export type BatchAuthorizationOperation =
  | "authorization.owned-profiles"
  | "authorization.transaction-accounts"
  | "authorization.transaction-categories";

export type BatchAuthorizationOperationRunner = <Result>(
  operation: BatchAuthorizationOperation,
  query: () => Promise<Result>,
) => Promise<Result>;

type ObservedRow = {
  id: string;
  profileId?: string | null;
  name?: string;
};

type ProfileState = {
  name: string;
  live: boolean;
};

type AuthorizedRun = {
  /** Current proven ownership, including tombstoned profiles. */
  ownedProfileIds: string[];
  /** Live, proven-owned profile ids among a profile-delete run's submitted ids. */
  liveTargetProfileIds: string[];
};

export type BatchAuthorization = {
  authorize(mutations: Mutation[]): AuthorizedRun;
  observe(mutations: Mutation[], returnedRows: ObservedRow[]): void;
  ownedProfileIds(): string[];
  profileName(profileId: string): string | null;
};

function forbidden(): Response {
  return new Response("That record does not belong to the selected profile.", { status: 403 });
}

function uniqueIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id) => id != null))];
}

function assertAllOwned(profileIds: string[], profiles: Map<string, ProfileState>): void {
  if (profileIds.some((profileId) => !profiles.has(profileId))) throw forbidden();
}

/**
 * Builds the transaction-local authorization context for newly claimed mutations.
 *
 * The PostgreSQL reads happen once here, through the same operation seam used by push query-budget
 * tests. After construction, ordered runs can only change the context through `observe`, using rows
 * their guarded writes actually returned.
 */
export async function createBatchAuthorization(
  db: Executor,
  userId: number,
  mutations: Mutation[],
  runOperation: BatchAuthorizationOperationRunner,
): Promise<BatchAuthorization> {
  const ownedProfiles = await runOperation("authorization.owned-profiles", () =>
    withSyncPhase(
      "push.authorization",
      () =>
        db
          .select({
            id: profilesTable.id,
            name: profilesTable.name,
            deletedAt: profilesTable.deletedAt,
          })
          .from(profilesTable)
          .where(eq(profilesTable.userId, userId)),
      { authorizationCheck: "owned_profiles" },
      (rows) => ({ rowCount: rows.length }),
    ),
  );
  const profiles = new Map<string, ProfileState>(
    ownedProfiles.map((profile) => [
      profile.id,
      { name: profile.name, live: profile.deletedAt == null },
    ]),
  );
  const initialOwnedProfileIds = [...profiles.keys()];
  const transactionUpserts = mutations.filter(
    (mutation): mutation is Extract<Mutation, { table: "transactions"; op: "upsert" }> =>
      mutation.table === "transactions" && mutation.op === "upsert",
  );
  const referencedAccountIds = uniqueIds(
    transactionUpserts.map((mutation) => mutation.payload.accountId),
  );
  const referencedCategoryIds = uniqueIds(
    transactionUpserts.map((mutation) => mutation.payload.categoryId),
  );

  const accountRows =
    referencedAccountIds.length === 0 || initialOwnedProfileIds.length === 0
      ? []
      : await runOperation("authorization.transaction-accounts", () =>
          withSyncPhase(
            "push.authorization",
            () =>
              db
                .select({ id: accountsTable.id, profileId: accountsTable.profileId })
                .from(accountsTable)
                .where(
                  and(
                    inArray(accountsTable.id, referencedAccountIds),
                    inArray(accountsTable.profileId, initialOwnedProfileIds),
                    isNull(accountsTable.deletedAt),
                  ),
                ),
            {
              authorizationCheck: "transaction_accounts",
              referenceCount: referencedAccountIds.length,
            },
            (rows) => ({ rowCount: rows.length }),
          ),
        );
  const categoryRows =
    referencedCategoryIds.length === 0 || initialOwnedProfileIds.length === 0
      ? []
      : await runOperation("authorization.transaction-categories", () =>
          withSyncPhase(
            "push.authorization",
            () =>
              db
                .select({ id: categoriesTable.id, profileId: categoriesTable.profileId })
                .from(categoriesTable)
                .where(
                  and(
                    inArray(categoriesTable.id, referencedCategoryIds),
                    inArray(categoriesTable.profileId, initialOwnedProfileIds),
                    isNull(categoriesTable.deletedAt),
                  ),
                ),
            {
              authorizationCheck: "transaction_categories",
              referenceCount: referencedCategoryIds.length,
            },
            (rows) => ({ rowCount: rows.length }),
          ),
        );
  const accountProfiles = new Map(accountRows.map((row) => [row.id, row.profileId]));
  const categoryProfiles = new Map(categoryRows.map((row) => [row.id, row.profileId]));

  return {
    authorize(runMutations) {
      const first = runMutations[0];
      if (!first) return { ownedProfileIds: [...profiles.keys()], liveTargetProfileIds: [] };

      if (first.table === "profiles") {
        const liveTargetProfileIds =
          first.op === "delete"
            ? runMutations
                .map((mutation) => mutation.rowId)
                .filter((profileId) => profiles.get(profileId)?.live === true)
            : [];
        return { ownedProfileIds: [...profiles.keys()], liveTargetProfileIds };
      }

      if (first.op === "upsert") {
        const upserts = runMutations.filter(
          (mutation): mutation is Extract<Mutation, { op: "upsert" }> => mutation.op === "upsert",
        );
        assertAllOwned(
          uniqueIds(
            upserts.flatMap((mutation) =>
              "profileId" in mutation.payload ? [mutation.payload.profileId] : [],
            ),
          ),
          profiles,
        );

        if (first.table === "transactions") {
          for (const mutation of upserts) {
            if (mutation.table !== "transactions") continue;
            const { accountId, categoryId, profileId } = mutation.payload;
            if (accountId != null && accountProfiles.get(accountId) !== profileId)
              throw forbidden();
            if (categoryId != null && categoryProfiles.get(categoryId) !== profileId) {
              throw forbidden();
            }
          }
        }
      }

      return { ownedProfileIds: [...profiles.keys()], liveTargetProfileIds: [] };
    },

    observe(runMutations, returnedRows) {
      const first = runMutations[0];
      if (!first || returnedRows.length === 0) return;

      if (first.table === "profiles") {
        if (first.op === "delete") {
          for (const row of returnedRows) {
            const profile = profiles.get(row.id);
            if (!profile) continue;
            profile.live = false;
            for (const [id, profileId] of accountProfiles) {
              if (profileId === row.id) accountProfiles.delete(id);
            }
            for (const [id, profileId] of categoryProfiles) {
              if (profileId === row.id) categoryProfiles.delete(id);
            }
          }
          return;
        }

        for (const row of returnedRows) {
          if (row.name != null) profiles.set(row.id, { name: row.name, live: true });
        }
        return;
      }

      if (first.table === "accounts") {
        for (const row of returnedRows) {
          if (first.op === "delete") accountProfiles.delete(row.id);
          else if (row.profileId != null && profiles.has(row.profileId)) {
            accountProfiles.set(row.id, row.profileId);
          }
        }
        return;
      }

      if (first.table === "categories") {
        for (const row of returnedRows) {
          if (first.op === "delete") categoryProfiles.delete(row.id);
          else if (row.profileId != null && profiles.has(row.profileId)) {
            categoryProfiles.set(row.id, row.profileId);
          }
        }
      }
    },

    ownedProfileIds: () => [...profiles.keys()],
    profileName: (profileId) => profiles.get(profileId)?.name ?? null,
  };
}
