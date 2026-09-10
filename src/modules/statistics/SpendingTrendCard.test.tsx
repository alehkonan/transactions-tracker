// @vitest-environment jsdom
import { act, cloneElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpendingTrendCard } from "~/modules/statistics/SpendingTrendCard";
import { formatMoney } from "~/utils/format-money";
import type { ReactElement } from "react";
import type { Root } from "react-dom/client";

// jsdom has no layout. Keep the real chart, tooltip, and keyboard behavior under test.
vi.mock("recharts", async (importOriginal) => {
  const original = await importOriginal<typeof import("recharts")>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children as ReactElement<{ width: number; height: number }>, {
        width: 600,
        height: 288,
      }),
  };
});

let container: HTMLDivElement;
let root: Root;
const usd = (value: number) => formatMoney(String(value), "USD");
const trend = [
  { day: 1, cumulativeUsd: 1500 },
  { day: 2, cumulativeUsd: 1980 },
  { day: 3, cumulativeUsd: 2000 },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 10, 12));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SpendingTrendCard", () => {
  it("names the keyboard chart and provides a cumulative summary and data equivalent", async () => {
    await act(async () => {
      root.render(<SpendingTrendCard hasSpendingData month="2026-09" trend={trend} />);
    });

    const chart = container.querySelector('[role="application"]');
    expect(chart?.getAttribute("aria-label")).toBe("Cumulative spending for September 2026 in USD");
    expect(chart?.getAttribute("tabindex")).toBe("0");
    const summary = document.getElementById(chart?.getAttribute("aria-describedby") ?? "");
    expect(summary?.textContent).toContain("September 2026 total:");
    expect(summary?.textContent).toContain(usd(2000));
    expect(summary?.textContent).not.toContain("USD");
    expect(summary?.textContent).toContain("Running total, not daily spending.");
    const table = container.querySelector("table")!;
    // Tables retain intrinsic minimum widths; hide the wrapper, not the table itself.
    expect(table.parentElement?.className).toBe("sr-only");
    expect(table.className).not.toContain("sr-only");
    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toBe(`Sep 2${usd(1980)} USD`);
    expect(container.querySelector("caption")?.textContent).toContain("September 2026 in USD");
  });

  it("shows a selected-month cumulative date and amount when navigating by keyboard", async () => {
    await act(async () => {
      root.render(<SpendingTrendCard hasSpendingData month="2026-09" trend={trend} />);
    });
    const chart = container.querySelector<SVGElement>('[role="application"]')!;
    await act(async () => chart.focus());
    await act(async () => {
      chart.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    const tooltip = container.querySelector(".recharts-tooltip-wrapper");
    expect(tooltip?.textContent).toContain("Spent through Sep 2");
    expect(tooltip?.textContent).toContain(usd(1980));
    expect(tooltip?.textContent).not.toContain("USD");
    expect(tooltip?.textContent).not.toContain(usd(480));
  });

  it("cuts off both the current-month total and accessible data at the local current day", async () => {
    vi.setSystemTime(new Date(2026, 8, 2, 23, 30));
    await act(async () => {
      root.render(<SpendingTrendCard hasSpendingData month="2026-09" trend={trend} />);
    });
    expect(container.textContent).toContain("September 2026 month-to-date:");
    expect(container.textContent).toContain("Through Sep 2.");
    expect(container.textContent).toContain(usd(1980));
    expect(container.textContent).not.toContain(usd(2000));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("keeps historical months complete even when today is early in another month", async () => {
    vi.setSystemTime(new Date(2026, 9, 1));
    await act(async () => {
      root.render(<SpendingTrendCard hasSpendingData month="2026-09" trend={trend} />);
    });
    expect(container.textContent).toContain(usd(2000));
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it.each([false, true])("handles empty data with hasSpendingData=%s", async (hasSpendingData) => {
    await act(async () => {
      root.render(
        <SpendingTrendCard hasSpendingData={hasSpendingData} month="2026-09" trend={[]} />,
      );
    });
    expect(container.textContent).toContain(usd(0));
    expect(container.textContent).toContain("No spending data for September 2026.");
    expect(container.querySelector('[role="application"]')).toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });
});
