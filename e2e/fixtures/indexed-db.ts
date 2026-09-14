import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export const DATABASE_NAME = "transactions-tracker";
export const DATABASE_VERSION = 3;

export type ReplicaDescriptor = {
  replicaId: string;
  identity: { ownerUserId: number; replicaId: string; username: string } | null;
  lifecycle: "active" | "transitioning" | "signed-out";
  syncAuth?: "unknown" | "authenticated" | "login-required" | "owner-mismatch";
  legacyOwnership:
    | { kind: "unbound" }
    | { kind: "candidate"; ownerUserId: number }
    | { kind: "recovery-required"; reasons: string[] }
    | { kind: "migrated" };
};

export async function waitForDatabaseVersion(
  page: Page,
  expectedVersion = DATABASE_VERSION,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async (databaseName) => {
        const databases = await indexedDB.databases();
        return databases.find((database) => database.name === databaseName)?.version ?? null;
      }, DATABASE_NAME),
    )
    .toBe(expectedVersion);
}

export async function readReplicaDescriptor(page: Page): Promise<ReplicaDescriptor> {
  return page.evaluate(async (databaseName) => {
    const request = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });

    try {
      const descriptorRequest = database
        .transaction("meta", "readonly")
        .objectStore("meta")
        .get("replicaDescriptor");
      return await new Promise<ReplicaDescriptor>((resolve, reject) => {
        descriptorRequest.addEventListener("success", () => resolve(descriptorRequest.result));
        descriptorRequest.addEventListener("error", () => reject(descriptorRequest.error));
      });
    } finally {
      database.close();
    }
  }, DATABASE_NAME);
}

export async function readReplicaOwnerUserId(page: Page): Promise<number> {
  const descriptor = await readReplicaDescriptor(page);
  const ownerUserId = descriptor.identity?.ownerUserId;
  if (ownerUserId == null) throw new Error("The browser replica has no confirmed owner.");
  return ownerUserId;
}
