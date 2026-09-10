// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AveragePeriodToggle } from "~/modules/statistics/AveragePeriodToggle";
import { computeDailyAverages } from "~/modules/statistics/compute-daily-averages";
import { DailyAverageCard } from "~/modules/statistics/DailyAverageCard";
import { MoneyRunwayCard } from "~/modules/statistics/MoneyRunwayCard";
import { RunwayCalculationDetails } from "~/modules/statistics/RunwayCalculationDetails";
import { formatMoney } from "~/utils/format-money";
import type { Root } from "react-dom/client";
import type { AveragePeriod } from "~/modules/statistics/compute-daily-averages";

let container: HTMLDivElement;
let root: Root;
const today = new Date(2026, 8, 10, 12);
const usd = (value: number) => formatMoney(String(value), "USD");
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, " ") ?? "";

function averages({ balance = "100", expense = "-930", period = "3m" as AveragePeriod } = {}) {
  return computeDailyAverages({
    accounts: [
      {
        id: "usd",
        name: "Current",
        initialBalance: "0",
        balance,
        currencyCode: "USD",
        status: "ACTIVE",
        type: "CURRENT",
        profileId: "profile",
        updatedAt: today,
        deletedAt: null,
      },
    ],
    transactions:
      expense === "0"
        ? []
        : [
            {
              id: "expense",
              type: "EXPENSE",
              amount: expense,
              necessityLevel: "MEDIUM",
              comment: null,
              accountId: "usd",
              categoryId: null,
              profileId: "profile",
              createdAt: today,
              updatedAt: today,
              deletedAt: null,
            },
          ],
    usdRates: { USD: 1 },
    period,
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(today);
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

describe("statistics summary", () => {
  it("presents runway as conditional on stopped income and unchanged spending, not a guaranteed depletion date", async () => {
    const result = averages();
    await act(async () => {
      root.render(<MoneyRunwayCard runway={result.runway} perDayUsd={result.expense.perDayUsd} />);
    });

    expect(text(container)).toContain("Estimated runway");
    expect(text(container)).toMatch(/if income stopped/i);
    expect(text(container)).toMatch(/spending stayed at this rate/i);
    expect(text(container)).toContain("10 days");
    expect(text(container)).toMatch(/active current \+ savings/i);
    expect(text(container)).toContain(usd(100));
    expect(text(container)).toContain(usd(10));
    expect(text(container)).toContain("could last until Sep 20, 2026");
    expect(text(container)).not.toMatch(/will (?:last|run out)|empty on/i);
  });

  it("shows no estimate without spending, rather than an infinite runway or depletion date", async () => {
    const result = averages({ expense: "0" });
    await act(async () => {
      root.render(<MoneyRunwayCard runway={result.runway} perDayUsd={result.expense.perDayUsd} />);
    });

    expect(text(container)).toContain("No estimate");
    expect(text(container.querySelector("p:last-child"))).toMatch(/expenses|spending/i);
    expect(text(container)).not.toMatch(/could last until|infinity|infinite|0 days/i);
  });

  it.each(["0", "-100"])(
    "explains the lack of positive balance (%s) instead of implying a future runway",
    async (balance) => {
      const result = averages({ balance });
      await act(async () => {
        root.render(
          <MoneyRunwayCard runway={result.runway} perDayUsd={result.expense.perDayUsd} />,
        );
      });

      expect(text(container)).toContain("0 days");
      expect(text(container)).toMatch(/no positive available balance/i);
      expect(text(container)).not.toMatch(/no estimate|could last until|less than one day/i);
    },
  );

  it("distinguishes a positive balance lasting less than a day from no balance", async () => {
    const result = averages({ balance: "0.99" });
    await act(async () => {
      root.render(<MoneyRunwayCard runway={result.runway} perDayUsd={result.expense.perDayUsd} />);
    });

    expect(text(container)).toContain("0 days");
    expect(text(container)).toMatch(/less than one day/i);
    expect(text(container)).not.toMatch(/no positive available balance|could last until/i);
  });

  it("keeps the finite runway when tiny spending rounds to zero in the displayed daily amount", async () => {
    const result = averages({ balance: "0.01", expense: "-0.01" });
    await act(async () => {
      root.render(<MoneyRunwayCard runway={result.runway} perDayUsd={result.expense.perDayUsd} />);
    });

    expect(result.expense.perDayUsd).toBe(0);
    expect(result.runway.days).toBe(93);
    expect(text(container)).toContain(`${usd(0)} / day`);
    expect(text(container)).toContain("could last until Dec 12, 2026");
    expect(text(container)).not.toContain("No estimate");
  });

  it("explains the actual calendar-day formula and its assumptions in an expandable disclosure", async () => {
    const result = averages();
    await act(async () => root.render(<RunwayCalculationDetails averages={result} />));

    const details = container.querySelector("details")!;
    const summary = details.querySelector("summary")!;
    expect(details.open).toBe(false);
    expect(text(summary)).toMatch(/how.*calculated/i);
    const warning = container.querySelector("p");
    expect(details.contains(warning)).toBe(false);
    expect(text(warning)).toContain("93 calendar days");
    expect(text(warning)).toMatch(/unrecorded expenses.*estimate too long/i);

    await act(async () => summary.click());
    expect(details.open).toBe(true);
    const explanation = text(details);
    expect(explanation).toContain(result.rangeLabel);
    expect(explanation).toContain(`${usd(930)} ÷ 93 calendar days = ${usd(10)} per day`);
    expect(explanation).toMatch(/income uses the same dates and denominator/i);
    expect(explanation).toMatch(/today counts as a full day/i);
    expect(explanation).toMatch(/days without records count as zero/i);
    expect(explanation).toMatch(/active current and savings balances.*average daily spending/i);
    expect(explanation).toMatch(/no future income/i);
    expect(explanation).toMatch(/archived balances are excluded/i);
    expect(explanation).toMatch(/income and expenses from archived accounts still count/i);
    expect(explanation).toMatch(/transfers do not/i);
    expect(explanation).toMatch(/converted to USD.*latest exchange rates.*device/i);
    expect(explanation).toMatch(/not the rates on each transaction date/i);
    expect(explanation).toMatch(/displayed amounts are rounded/i);
    expect(explanation).toMatch(/unrounded spending average.*rounds down to whole days/i);
    expect(explanation).toMatch(
      /longer history.*more calendar days, not necessarily more recorded expenses/i,
    );

    await act(async () => {
      root.render(<RunwayCalculationDetails averages={averages({ period: "6m" })} />);
    });
    expect(text(details)).toContain("Mar 10 – Sep 10");
    expect(text(details)).toContain(`${usd(930)} ÷ 185 calendar days = ${usd(5.03)} per day`);
  });

  it.each([
    { title: "Spending per day", shortTitle: "Spent / day", tone: "expense" as const },
    { title: "Income per day", shortTitle: "Income / day", tone: "income" as const },
  ])(
    "names the $title mobile button with its current USD value and opens a named, Escape-dismissible real popover",
    async (props) => {
      const renderCard = (period: AveragePeriod) => {
        const result = averages({ period });
        root.render(
          <DailyAverageCard
            {...props}
            perDayUsd={result.expense.perDayUsd}
            totalUsd={result.expense.totalUsd}
            days={result.days}
            rangeLabel={result.rangeLabel}
          />,
        );
      };
      await act(async () => renderCard("3m"));
      const trigger = container.querySelector("button")!;
      expect(trigger.getAttribute("aria-label")).toBe(
        `${props.shortTitle}: ${usd(10)} USD. Show calculation`,
      );
      expect(trigger.textContent).toContain(usd(10));

      await act(async () => renderCard("6m"));
      expect(trigger.getAttribute("aria-label")).toBe(
        `${props.shortTitle}: ${usd(5.03)} USD. Show calculation`,
      );
      expect(trigger.textContent).toContain(usd(5.03));
      await act(async () => {
        trigger.focus();
        trigger.click();
      });

      const popup = document.body.querySelector('[role="dialog"]')!;
      expect(popup).not.toBeNull();
      expect(popup.getAttribute("aria-label")).toBe(`${props.title} calculation`);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(trigger.getAttribute("aria-controls")).toBe(popup.id);
      expect(text(popup)).toContain(`${usd(930)} ÷ 185 calendar days`);
      expect(text(popup)).toContain("Mar 10 – Sep 10");
      expect(text(popup)).toContain("USD");
      expect(text(popup)).toContain(`${usd(5.03)} / day`);

      await act(async () => {
        (document.activeElement ?? popup).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    },
  );

  it.each(["3m", "6m", "1y"] as const)(
    "labels the history choices and keeps %s selected when clicking it again",
    async (period) => {
      let value: AveragePeriod = "3m";
      const onValueChange = vi.fn((next: AveragePeriod) => {
        value = next;
        renderToggle();
      });
      function renderToggle() {
        root.render(<AveragePeriodToggle value={value} onValueChange={onValueChange} />);
      }
      await act(async () => renderToggle());

      const group = container.querySelector("fieldset")!;
      expect(text(group.querySelector("legend")!)).toMatch(
        /spending history.*runway and daily averages/i,
      );
      const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual(["3M", "6M", "1Y"]);
      expect(radios.map((radio) => radio.getAttribute("aria-label"))).toEqual([
        "Last 3 months",
        "Last 6 months",
        "Last year",
      ]);
      expect(radios.filter((radio) => radio.checked)).toHaveLength(1);
      expect(radios[0].checked).toBe(true);

      const index = (["3m", "6m", "1y"] as const).indexOf(period);
      const target = radios[index];
      if (!target.checked) {
        await act(async () => target.click());
        expect(onValueChange).toHaveBeenLastCalledWith(period);
      }
      expect(value).toBe(period);
      expect(radios.filter((radio) => radio.checked)).toHaveLength(1);
      expect(target.checked).toBe(true);

      const changeCount = onValueChange.mock.calls.length;
      await act(async () => target.click());
      expect(onValueChange).toHaveBeenCalledTimes(changeCount);
      expect(radios.filter((radio) => radio.checked)).toHaveLength(1);
      expect(target.checked).toBe(true);
    },
  );
});
