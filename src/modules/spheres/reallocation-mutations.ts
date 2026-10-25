import { currencyCodeEnum } from "~/database/enums";
import { commit, newRow } from "~/modules/sync/mutations";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { isMoneyInput, negateMoney, sumMoney } from "~/utils/money";
import { uuidV7 } from "~/utils/uuid-v7";
import { findReallocation } from "./reallocation";
import type { ReplicaContext } from "~/modules/sync/replica-identity";
import type { ReallocationPayload } from "~/modules/sync/sync-types";

export type ReallocationInput = {
  fromSphereId: string;
  toSphereId: string;
  currencyCode: ReallocationPayload["currencyCode"];
  amount: string;
};

export function saveReallocation(
  profileId: string,
  input: ReallocationInput,
  context: ReplicaContext,
  reallocationId?: string,
): Promise<void> {
  if (!isMoneyInput(input.amount) || Number(input.amount) <= 0)
    throw new Error("Enter a positive amount with at most two decimal places.");
  if (!currencyCodeEnum.enumValues.includes(input.currencyCode))
    throw new Error("Choose a currency.");
  const existing = reallocationId
    ? findReallocation(useSyncStore.getState().allocations, reallocationId)
    : undefined;
  if (reallocationId && !existing)
    throw new Error("Finish loading the complete reallocation before editing.");
  const id = reallocationId ?? uuidV7();
  const amount = sumMoney([input.amount]);
  const shared = {
    profileId,
    reallocationId: id,
    transactionId: null,
    openingAccountId: null,
    currencyCode: input.currencyCode,
    createdAt: existing?.[0].createdAt ?? new Date(),
  } as const;
  return commit(
    [
      { sphereId: input.fromSphereId, amount: negateMoney(amount) },
      { sphereId: input.toSphereId, amount },
    ].map((side, index) => {
      const payload: ReallocationPayload = { ...shared, ...side };
      return {
        op: "upsert",
        table: "allocations",
        operationId: id,
        payload,
        row: existing ? { ...existing[index], ...payload } : newRow(payload),
      };
    }),
    context,
  );
}

export function deleteReallocation(id: string, context: ReplicaContext): Promise<void> {
  const pair = findReallocation(useSyncStore.getState().allocations, id);
  if (!pair) throw new Error("Finish loading the complete reallocation before deleting.");
  return commit(
    pair.map((row) => ({ op: "delete", table: "allocations", row, operationId: id })),
    context,
  );
}
