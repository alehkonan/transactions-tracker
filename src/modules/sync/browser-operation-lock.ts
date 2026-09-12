const REPLICA_OPERATION_LOCK = "transactions-tracker:replica-operation";

type AsyncLockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

export class BrowserOperationLockUnavailableError extends Error {
  constructor() {
    super(
      "This browser cannot safely coordinate synchronization and account changes across tabs. Local data remains available, but sync and authentication are paused.",
    );
    this.name = "BrowserOperationLockUnavailableError";
  }
}

/** Serializes every cookie-changing auth operation and sync run across all tabs sharing IndexedDB. */
export function runWithBrowserOperationLock<T>(work: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== "undefined" && "locks" in navigator
      ? (navigator.locks as unknown as AsyncLockManager)
      : null;

  if (!locks) return Promise.reject(new BrowserOperationLockUnavailableError());
  return locks.request(REPLICA_OPERATION_LOCK, work);
}
