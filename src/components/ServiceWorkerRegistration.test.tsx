// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceWorkerRegistration } from "./ServiceWorkerRegistration";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubEnv("PROD", true);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ServiceWorkerRegistration", () => {
  it("reports a sanitized registration failure once without a toast loop", async () => {
    const serviceWorker = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      register: vi.fn().mockRejectedValue(new Error("sensitive browser detail")),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => {
      root.render(<ServiceWorkerRegistration />);
      await Promise.resolve();
    });

    expect(container.querySelector("output")?.textContent).toContain("Offline mode unavailable");
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "Service worker registration failed; offline mode is unavailable.",
    );
    expect(serviceWorker.register).toHaveBeenCalledOnce();
  });

  it("reports an initial install that becomes redundant", async () => {
    let onStateChange: (() => void) | undefined;
    const installingWorker = {
      state: "installing",
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        onStateChange = listener;
      }),
      removeEventListener: vi.fn(),
    };
    const serviceWorker = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      controller: null,
      register: vi.fn().mockResolvedValue({
        active: null,
        installing: installingWorker,
        waiting: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => {
      root.render(<ServiceWorkerRegistration />);
      await Promise.resolve();
    });
    await act(async () => {
      installingWorker.state = "redundant";
      onStateChange?.();
    });

    expect(container.querySelector("output")?.textContent).toContain("Offline mode unavailable");
    expect(warning).toHaveBeenCalledOnce();
  });

  it("shows a passive notice for a worker that is already waiting", async () => {
    const serviceWorker = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      controller: { postMessage: vi.fn() },
      register: vi.fn().mockResolvedValue({
        active: {},
        installing: null,
        waiting: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: serviceWorker,
    });

    await act(async () => {
      root.render(<ServiceWorkerRegistration />);
      await Promise.resolve();
    });

    expect(container.querySelector("output")?.textContent).toContain(
      "Update ready. Finish your edits, then close all app windows and reopen.",
    );
    expect(serviceWorker.controller.postMessage).toHaveBeenCalledWith({
      type: "transactions-tracker:service-worker",
      action: "get-build-id",
    });
  });
});
