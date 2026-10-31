// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryForm } from "~/modules/categories/CategoryForm";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { Dialog } from "./Dialog";

const { updateCategory } = vi.hoisted(() => ({ updateCategory: vi.fn() }));
vi.mock("~/modules/categories/category-mutations", () => ({
  updateCategory,
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  updateCategory.mockReset().mockResolvedValue(undefined);
  useSyncStore.setState({
    replicaContext: { replicaId: "test-replica", ownerUserId: 1 },
    selectedProfileId: "profile",
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function element<T extends HTMLElement>(testId: string) {
  const found = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`Missing ${testId}`);
  return found;
}

async function click(testId: string) {
  await act(async () => element(testId).click());
}

async function openEditor() {
  await act(async () =>
    root.render(
      <Dialog
        title="Edit category"
        renderTrigger={({ onOpen }) => (
          <button onClick={onOpen} data-testid="open-category">
            Edit category
          </button>
        )}
      >
        <CategoryForm
          colors={[{ id: 1, hex: "#000000" }]}
          category={{ id: "category", name: "Food", colorId: 1, colorHex: "#000000" }}
        />
      </Dialog>,
    ),
  );
  await click("open-category");
}

async function rename() {
  await act(async () => {
    const input = element<HTMLInputElement>("category-name");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Groceries",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("dialog form lifecycle", () => {
  it("cancels an unchanged form without a discard prompt", async () => {
    await openEditor();
    await click("category-cancel");
    expect(document.querySelector('[data-testid="discard-confirm"]')).toBeNull();
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull();
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("keeps edits after cancel and a failed save, then completes a successful retry without asking to discard", async () => {
    await openEditor();
    await rename();
    await click("category-cancel");
    expect(element("discard-confirm")).toBeDefined();
    await click("discard-keep-editing");
    expect(element<HTMLInputElement>("category-name").value).toBe("Groceries");

    updateCategory.mockRejectedValueOnce(new Error("Local storage is full. Free space and retry."));
    await click("category-submit");
    expect(element<HTMLInputElement>("category-name").value).toBe("Groceries");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Local storage is full",
    );

    await click("category-submit");
    expect(updateCategory).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull();
    expect(document.querySelector('[data-testid="discard-confirm"]')).toBeNull();
  });

  it("discards only after the explicit decision", async () => {
    await openEditor();
    await rename();
    await click("category-cancel");
    await click("discard-confirm");
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull();
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("keeps a saving form open until local persistence finishes", async () => {
    let finish!: () => void;
    updateCategory.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await openEditor();
    await rename();
    await click("category-submit");
    await click("category-cancel");
    expect(document.querySelector('[role="dialog"][data-open]')).not.toBeNull();
    expect(document.querySelector('[data-testid="discard-confirm"]')).toBeNull();
    await act(async () => finish());
    expect(document.querySelector('[role="dialog"][data-open]')).toBeNull();
  });
});
