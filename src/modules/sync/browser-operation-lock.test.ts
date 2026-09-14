import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserOperationLockUnavailableError,
  runWithBrowserOperationLock,
} from "./browser-operation-lock";

afterEach(() => vi.unstubAllGlobals());

describe("runWithBrowserOperationLock", () => {
  it("fails closed instead of pretending a per-tab queue is browser-wide", async () => {
    vi.stubGlobal("navigator", {});

    await expect(runWithBrowserOperationLock(async () => "unsafe")).rejects.toBeInstanceOf(
      BrowserOperationLockUnavailableError,
    );
  });

  it("uses the shared browser lock for the operation", async () => {
    const request = vi.fn(async (_name: string, callback: () => Promise<string>) => callback());
    vi.stubGlobal("navigator", { locks: { request } });

    await expect(runWithBrowserOperationLock(async () => "safe")).resolves.toBe("safe");
    expect(request).toHaveBeenCalledWith(
      "transactions-tracker:replica-operation",
      expect.any(Function),
    );
  });
});
