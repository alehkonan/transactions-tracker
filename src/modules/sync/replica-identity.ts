export type ReplicaIdentity = {
  ownerUserId: number;
  replicaId: string;
  username: string;
};

export type ReplicaLifecycle = "active" | "transitioning" | "signed-out";

export type LegacyRecoveryReason =
  | "missing-profile-owner"
  | "mixed-profile-owners"
  | "inconsistent-references";

export type LegacyOwnership =
  | { kind: "unbound" }
  | { kind: "candidate"; ownerUserId: number }
  | { kind: "recovery-required"; reasons: LegacyRecoveryReason[] }
  | { kind: "migrated" };

export type ReplicaDescriptor = {
  replicaId: string;
  identity: ReplicaIdentity | null;
  lifecycle: ReplicaLifecycle;
  legacyOwnership: LegacyOwnership;
};

/** Captured before asynchronous work and checked again by every durable write. */
export type ReplicaContext = {
  replicaId: string;
  ownerUserId: number | null;
};

export type BoundReplicaContext = ReplicaContext & { ownerUserId: number };

type LegacyProfile = { id: string; userId: number | null };
type LegacyOwnedRow = { id: string; profileId: string | null };
type LegacyTransaction = LegacyOwnedRow & {
  accountId: string;
  categoryId?: string | null;
};
type LegacyOutboxEntry = {
  table: string;
  rowId: string;
  op: string;
  payload?: unknown;
};

export type LegacyReplicaContents = {
  profiles: readonly LegacyProfile[];
  accounts: readonly LegacyOwnedRow[];
  categories: readonly LegacyOwnedRow[];
  transactions: readonly LegacyTransaction[];
  outbox: readonly LegacyOutboxEntry[];
};

function hasInconsistentReferences(contents: LegacyReplicaContents): boolean {
  const profileIds = new Set(contents.profiles.map((profile) => profile.id));
  const accounts = new Map(contents.accounts.map((account) => [account.id, account.profileId]));
  const categories = new Map(
    contents.categories.map((category) => [category.id, category.profileId]),
  );

  if (
    [...contents.accounts, ...contents.categories].some(
      (row) => row.profileId == null || !profileIds.has(row.profileId),
    )
  ) {
    return true;
  }

  if (
    contents.transactions.some((transaction) => {
      if (transaction.profileId == null || !profileIds.has(transaction.profileId)) return true;
      if (accounts.get(transaction.accountId) !== transaction.profileId) return true;
      return (
        transaction.categoryId != null &&
        categories.get(transaction.categoryId) !== transaction.profileId
      );
    })
  ) {
    return true;
  }

  const rowsByTable = new Map<string, Map<string, object>>([
    ["profiles", new Map(contents.profiles.map((row) => [row.id, row]))],
    ["accounts", new Map(contents.accounts.map((row) => [row.id, row]))],
    ["categories", new Map(contents.categories.map((row) => [row.id, row]))],
    ["transactions", new Map(contents.transactions.map((row) => [row.id, row]))],
  ]);

  return contents.outbox.some((entry) => {
    const row = rowsByTable.get(entry.table)?.get(entry.rowId);
    if (!row) return true;
    if (entry.op !== "upsert") return false;
    if (typeof entry.payload !== "object" || entry.payload == null) return true;

    const payload = entry.payload as Record<string, unknown>;
    if ("profileId" in row && payload.profileId !== row.profileId) return true;
    if (entry.table === "transactions") {
      const transaction = row as LegacyTransaction;
      if (payload.accountId !== transaction.accountId) return true;
      if ((payload.categoryId ?? null) !== (transaction.categoryId ?? null)) return true;
    }
    return false;
  });
}

/**
 * Classifies v2 ownership using local evidence only. A candidate is routing evidence for later
 * reconciliation, never proof that a server session owns these rows.
 */
export function classifyLegacyOwnership(contents: LegacyReplicaContents): LegacyOwnership {
  const hasRows =
    contents.profiles.length > 0 ||
    contents.accounts.length > 0 ||
    contents.categories.length > 0 ||
    contents.transactions.length > 0;
  if (!hasRows && contents.outbox.length === 0) return { kind: "unbound" };

  const ownerIds = new Set(
    contents.profiles
      .map((profile) => profile.userId)
      .filter((ownerUserId): ownerUserId is number => ownerUserId != null),
  );
  const hasOwnerlessProfiles = contents.profiles.some((profile) => profile.userId == null);
  const reasons: LegacyRecoveryReason[] = [];

  if (ownerIds.size === 0) reasons.push("missing-profile-owner");
  if (ownerIds.size > 1 || (ownerIds.size === 1 && hasOwnerlessProfiles)) {
    reasons.push("mixed-profile-owners");
  }
  if (hasInconsistentReferences(contents)) reasons.push("inconsistent-references");

  if (reasons.length > 0) return { kind: "recovery-required", reasons };
  return { kind: "candidate", ownerUserId: [...ownerIds][0] };
}

export function replicaContextFromDescriptor(descriptor: ReplicaDescriptor): ReplicaContext {
  const legacyOwner =
    descriptor.legacyOwnership.kind === "candidate" ? descriptor.legacyOwnership.ownerUserId : null;
  return {
    replicaId: descriptor.replicaId,
    ownerUserId: descriptor.identity?.ownerUserId ?? legacyOwner,
  };
}
