import { useNavigate } from "@tanstack/react-router";
import { format, parse, startOfMonth, startOfYear, subDays } from "date-fns";
import { useRef, useState } from "react";
import { Button } from "~/components/Button";
import { DatePicker, type DatePickerActions } from "~/components/DatePicker";
import type { DateRange } from "@daypicker/react";

type Props = {
  from?: string;
  to?: string;
};

const EMPTY_RANGE: DateRange = { from: undefined, to: undefined };

const parseDateKey = (dateKey: string) => parse(dateKey, "yyyy-MM-dd", new Date());

const toDateRange = (from?: string, to?: string): DateRange => ({
  from: from ? parseDateKey(from) : undefined,
  to: to ? parseDateKey(to) : undefined,
});

export const formatDateFilterLabel = ({ from, to }: DateRange) => {
  if (from && to) return `${format(from, "MMM d")} – ${format(to, "MMM d")}`;
  if (from) return `From ${format(from, "MMM d")}`;
  if (to) return `Until ${format(to, "MMM d")}`;
  return "Filter by date";
};

/**
 * Date-range quick filter for the transactions table; drives the `from`/`to` route search params.
 * The half-picked range lives in local state and is only pushed to the params — reloading the
 * table — once both ends are chosen, so picking a start date doesn't filter on it alone.
 */
export function TransactionsDateRangeFilter({ from, to }: Props) {
  const navigate = useNavigate({ from: "/transactions" });
  const datePicker = useRef<DatePickerActions>(null);
  const [range, setRange] = useState(() => toDateRange(from, to));
  const [applied, setApplied] = useState({ from, to });

  // Re-sync the in-progress range when the params change from the outside (back/forward, a link).
  if (applied.from !== from || applied.to !== to) {
    setApplied({ from, to });
    setRange(toDateRange(from, to));
  }

  const applyRange = (next: DateRange) =>
    navigate({
      search: (prev) => ({
        ...prev,
        from: next.from && format(next.from, "yyyy-MM-dd"),
        to: next.to && format(next.to, "yyyy-MM-dd"),
      }),
    });

  const handleSelect = (next: DateRange | undefined) => {
    const nextRange = next ?? EMPTY_RANGE;
    setRange(nextRange);
    // A range with only one end is still being picked — leave the table alone until it's complete.
    if (!nextRange.from || !nextRange.to) return;
    applyRange(nextRange);
    datePicker.current?.close();
  };

  const handleReset = () => {
    setRange(EMPTY_RANGE);
    applyRange(EMPTY_RANGE);
  };

  const applyPreset = (nextRange: DateRange) => {
    setRange(nextRange);
    applyRange(nextRange);
    datePicker.current?.close();
  };

  const today = new Date();

  return (
    <div className="flex flex-col gap-2">
      <DatePicker
        actionsRef={datePicker}
        mode="range"
        selected={range}
        onSelect={handleSelect}
        label={formatDateFilterLabel(range)}
        onReset={range.from || range.to ? handleReset : undefined}
        resetLabel="Clear date range"
        resetOnSelect
        captionLayout="label"
        disabled={{ after: today }}
        triggerClassName="h-11 min-w-44 md:h-9"
      />
      <div aria-label="Quick date ranges" className="flex flex-wrap gap-1.5">
        <Button
          variant="secondary"
          className="h-11 px-2 text-xs md:h-8"
          onClick={() => applyPreset({ from: subDays(today, 29), to: today })}
        >
          Last 30 days
        </Button>
        <Button
          variant="secondary"
          className="h-11 px-2 text-xs md:h-8"
          onClick={() => applyPreset({ from: startOfMonth(today), to: today })}
        >
          This month
        </Button>
        <Button
          variant="secondary"
          className="h-11 px-2 text-xs md:h-8"
          onClick={() => applyPreset({ from: startOfYear(today), to: today })}
        >
          This year
        </Button>
      </div>
    </div>
  );
}
