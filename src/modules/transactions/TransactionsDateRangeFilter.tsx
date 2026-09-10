import { useNavigate } from "@tanstack/react-router";
import { format, startOfMonth, startOfYear, subDays } from "date-fns";
import { useEffect, useId, useState } from "react";
import { Button } from "~/components/Button";

type Props = {
  from?: string;
  to?: string;
};

type DateRange = {
  from?: Date;
  to?: Date;
};

type DateRangeValues = {
  from: string;
  to: string;
};

export const formatDateFilterLabel = ({ from, to }: DateRange) => {
  if (from && to) return `${format(from, "MMM d")} – ${format(to, "MMM d")}`;
  if (from) return `From ${format(from, "MMM d")}`;
  if (to) return `Until ${format(to, "MMM d")}`;
  return "Filter by date";
};

const toDateKey = (date: Date) => format(date, "yyyy-MM-dd");

function getRangeError({ from, to }: DateRangeValues, today: string) {
  if (from > today || to > today) return "Dates cannot be in the future.";
  if (from && to && from > to) return "End date must be on or after start date.";
  return undefined;
}

/** Two native date boundaries that drive the transaction route search params. */
export function TransactionsDateRangeFilter({ from, to }: Props) {
  const navigate = useNavigate({ from: "/transactions" });
  const errorId = useId();
  const [values, setValues] = useState<DateRangeValues>({ from: from ?? "", to: to ?? "" });
  const today = new Date();
  const todayKey = toDateKey(today);
  const error = getRangeError(values, todayKey);

  useEffect(() => {
    setValues({ from: from ?? "", to: to ?? "" });
  }, [from, to]);

  const applyRange = (next: DateRangeValues) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        from: next.from || undefined,
        to: next.to || undefined,
      }),
    });
  };

  const updateBoundary = (boundary: keyof DateRangeValues, value: string) => {
    const next = { ...values, [boundary]: value };
    setValues(next);
    if (!getRangeError(next, todayKey)) applyRange(next);
  };

  const applyPreset = (next: DateRangeValues) => {
    setValues(next);
    applyRange(next);
  };

  const clear = () => {
    const next = { from: "", to: "" };
    setValues(next);
    applyRange(next);
  };

  return (
    <fieldset className="flex w-full min-w-0 flex-col gap-2">
      <legend className="text-text text-sm font-bold">Date range</legend>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-text-muted flex min-w-0 flex-col gap-1 text-xs font-semibold">
          From
          <input
            type="date"
            value={values.from}
            max={todayKey}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => updateBoundary("from", event.currentTarget.value)}
            className="border-border bg-surface text-text focus-visible:ring-accent h-11 w-full min-w-0 rounded-2xl border px-3 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:h-9"
          />
        </label>
        <label className="text-text-muted flex min-w-0 flex-col gap-1 text-xs font-semibold">
          To
          <input
            type="date"
            value={values.to}
            max={todayKey}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => updateBoundary("to", event.currentTarget.value)}
            className="border-border bg-surface text-text focus-visible:ring-accent h-11 w-full min-w-0 rounded-2xl border px-3 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:h-9"
          />
        </label>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}
      <div aria-label="Quick date ranges" className="flex flex-wrap gap-1.5">
        <Button
          variant="secondary"
          className="h-11 px-2 text-xs md:h-8"
          onClick={() => applyPreset({ from: toDateKey(subDays(today, 29)), to: todayKey })}
        >
          Last 30 days
        </Button>
        <Button
          variant="secondary"
          className="h-11 px-2 text-xs md:h-8"
          onClick={() => applyPreset({ from: toDateKey(startOfMonth(today)), to: todayKey })}
        >
          This month
        </Button>
        <Button
          variant="secondary"
          className="h-11 px-2 text-xs md:h-8"
          onClick={() => applyPreset({ from: toDateKey(startOfYear(today)), to: todayKey })}
        >
          This year
        </Button>
        {(values.from || values.to) && (
          <Button variant="secondary" className="h-11 px-2 text-xs md:h-8" onClick={clear}>
            Clear dates
          </Button>
        )}
      </div>
    </fieldset>
  );
}
