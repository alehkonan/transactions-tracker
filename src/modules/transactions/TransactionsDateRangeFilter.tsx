import { useNavigate } from "@tanstack/react-router";
import { format, parse } from "date-fns";
import { DatePicker } from "~/components/DatePicker";
import type { DateRange } from "@daypicker/react";

type Props = {
  from?: string;
  to?: string;
};

const parseDateKey = (dateKey: string) => parse(dateKey, "yyyy-MM-dd", new Date());

const formatChipDate = (dateKey: string) => format(parseDateKey(dateKey), "MMM d");

const filterLabel = (from?: string, to?: string) => {
  if (from && to) return `${formatChipDate(from)} – ${formatChipDate(to)}`;
  if (from) return `From ${formatChipDate(from)}`;
  if (to) return `Until ${formatChipDate(to)}`;
  return "Filter by date";
};

/** Date-range quick filter for the transactions table; drives the `from`/`to` route search params. */
export function TransactionsDateRangeFilter({ from, to }: Props) {
  const navigate = useNavigate({ from: "/transactions" });

  const setRange = (next: { from?: string; to?: string }) =>
    navigate({ search: (prev) => ({ ...prev, from: next.from, to: next.to }) });

  const startDate = from ? parseDateKey(from) : undefined;
  const endDate = to ? parseDateKey(to) : undefined;

  const handleSelect = (range: DateRange | undefined) =>
    setRange({
      from: range?.from ? format(range.from, "yyyy-MM-dd") : undefined,
      to: range?.to ? format(range.to, "yyyy-MM-dd") : undefined,
    });

  return (
    <DatePicker
      mode="range"
      selected={{ from: startDate, to: endDate }}
      onSelect={handleSelect}
      label={filterLabel(from, to)}
      resetOnSelect
      disabled={{ after: new Date() }}
    />
  );
}
