import { runWithBrowserOperationLock } from "~/modules/sync/browser-operation-lock";
import {
  assertCurrentReplicaContext,
  beginReplicaTransition,
  cancelReplicaTransition,
  captureReplicaContext,
  completeReplicaSignIn,
  readLocalSnapshot,
  recoverInterruptedReplicaTransition,
  replaceLocalReplica,
} from "~/modules/sync/idb";
import { replicaContextFromDescriptor } from "~/modules/sync/replica-identity";
import {
  announceReplicaTransition,
  finishReplicaReplacement,
  resumeSyncAfterSignIn,
} from "~/modules/sync/sync-engine";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { uuidV7 } from "~/utils/uuid-v7";
import type { ReplicaContext } from "~/modules/sync/replica-identity";

type SessionUser = { id: number; username: string };
type SignInIntent = "sign-in" | "sign-up";
type SignInFinalizer = (expectedUserId: number | undefined) => Promise<SessionUser | Response>;

async function unwrapIdentity(value: SessionUser | Response): Promise<SessionUser> {
  if (!(value instanceof Response)) return value;

  const raw = (await value.text()).trim();
  if ((value.headers.get("content-type") ?? "").includes("application/json")) {
    let body: { error?: unknown } | undefined;
    try {
      body = JSON.parse(raw) as { error?: unknown };
    } catch {
      body = undefined;
    }
    if (typeof body?.error === "string") throw new Error(body.error);
  }
  throw new Error(raw || `Request failed (${value.status}).`);
}

function assertServerIdentity(identity: SessionUser, expectedUserId: number | null): void {
  if (!Number.isInteger(identity.id) || identity.id <= 0 || typeof identity.username !== "string") {
    throw new Error("The authentication server returned an invalid identity.");
  }
  if (expectedUserId != null && identity.id !== expectedUserId) {
    throw new Error("These credentials belong to a different user than this local replica.");
  }
}

/**
 * Completes every auth method under the same lock as sync. The authenticator prompt and password form
 * happen before this call; only the cookie-changing server finalization is serialized.
 */
export function completeSignIn(
  intent: SignInIntent,
  finalize: SignInFinalizer,
): Promise<SessionUser> {
  return runWithBrowserOperationLock(async () => {
    await recoverInterruptedReplicaTransition();
    const replicaContext = await captureReplicaContext({ allowRecovery: true });
    if (intent === "sign-up" && replicaContext.ownerUserId != null) {
      throw new Error(
        "Sign out explicitly before creating a different account. Your current local data was not changed.",
      );
    }

    const transitionId = uuidV7();
    await beginReplicaTransition(replicaContext, {
      transitionId,
      kind: "sign-in",
      startedAt: Date.now(),
    });
    announceReplicaTransition(replicaContext);

    try {
      const identity = await unwrapIdentity(
        await finalize(replicaContext.ownerUserId ?? undefined),
      );
      assertServerIdentity(identity, replicaContext.ownerUserId);
      await completeReplicaSignIn(replicaContext, transitionId, {
        ownerUserId: identity.id,
        username: identity.username,
      });
      const confirmedContext: ReplicaContext = {
        replicaId: replicaContext.replicaId,
        ownerUserId: identity.id,
      };
      resumeSyncAfterSignIn(confirmedContext);
      return identity;
    } catch (error) {
      await cancelReplicaTransition(replicaContext, transitionId).catch(() => undefined);
      if (replicaContext.ownerUserId != null) {
        useSyncStore.setState({
          status: "unauthorized",
          error: "Sign in again before synchronization resumes.",
        });
      }
      throw error;
    }
  });
}

/** Serializes authenticated requests whose session middleware may refresh or clear cookies. */
export function runAuthenticatedRequest<T>(request: () => Promise<T>): Promise<T> {
  return runWithBrowserOperationLock(async () => {
    const replicaContext = await captureReplicaContext();
    const result = await request();
    await assertCurrentReplicaContext(replicaContext);
    return result;
  });
}

/** Reads the durable queue at the moment the sign-out confirmation is opened. */
export async function readSignOutObligations(): Promise<{ outboxCount: number }> {
  const snapshot = await readLocalSnapshot();
  const context = replicaContextFromDescriptor(snapshot.descriptor);
  if (snapshot.descriptor.lifecycle !== "active") {
    throw new Error("The local workspace is already changing in another tab.");
  }
  const current = useSyncStore.getState().replicaContext;
  if (current && current.replicaId !== context.replicaId) {
    throw new Error("The visible workspace is stale. Reload before signing out.");
  }
  return { outboxCount: snapshot.outbox.count };
}

/** Server failure restores the original replica; only a confirmed sign-out may discard it. */
export function completeSignOut(finalize: () => Promise<unknown>): Promise<void> {
  return runWithBrowserOperationLock(async () => {
    await recoverInterruptedReplicaTransition();
    const replicaContext = await captureReplicaContext({ allowRecovery: true });
    const transitionId = uuidV7();
    await beginReplicaTransition(replicaContext, {
      transitionId,
      kind: "sign-out",
      startedAt: Date.now(),
    });
    announceReplicaTransition(replicaContext);

    try {
      const result = await finalize();
      if (result instanceof Response) await unwrapIdentity(result as Response);
      const replacement = await replaceLocalReplica(replicaContext, transitionId);
      await finishReplicaReplacement(replicaContext, replacement);
    } catch (error) {
      await cancelReplicaTransition(replicaContext, transitionId).catch(() => undefined);
      throw error;
    }
  });
}

/** Accept only same-origin UI paths, never schemes, protocol-relative URLs, or the login page itself. */
export function getSignInReturnPath(location: Location = window.location): string {
  const requested = new URLSearchParams(location.search).get("returnTo");
  if (!requested || !requested.startsWith("/") || requested.startsWith("//")) return "/";

  try {
    const destination = new URL(requested, location.origin);
    if (destination.origin !== location.origin || destination.pathname === "/login") return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}
