import { useNavigate } from "@tanstack/react-router";
import { format, parse } from "date-fns";
import { useRef, useState } from "react";
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

const filterLabel = ({ from, to }: DateRange) => {
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

  return (
    <DatePicker
      actionsRef={datePicker}
      mode="range"
      selected={range}
      onSelect={handleSelect}
      label={filterLabel(range)}
      onReset={range.from || range.to ? handleReset : undefined}
      resetOnSelect
      disabled={{ after: new Date() }}
    />
  );
}
