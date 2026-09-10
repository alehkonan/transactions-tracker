import { useId } from "react";
import { twMerge } from "tailwind-merge";
import type { AveragePeriod } from "~/modules/statistics/compute-daily-averages";

const options: { value: AveragePeriod; label: string; accessibleLabel: string }[] = [
  { value: "3m", label: "3M", accessibleLabel: "Last 3 months" },
  { value: "6m", label: "6M", accessibleLabel: "Last 6 months" },
  { value: "1y", label: "1Y", accessibleLabel: "Last year" },
];

type Props = {
  value: AveragePeriod;
  onValueChange: (period: AveragePeriod) => void;
};

/** Native radio group for the trailing window used by the per-day averages. */
export function AveragePeriodToggle({ value, onValueChange }: Props) {
  const name = useId();

  return (
    <fieldset className="shrink-0">
      <legend className="sr-only">Spending history used for runway and daily averages</legend>
      <div className="border-border bg-surface flex items-center gap-1 rounded-lg border p-1">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              className="peer sr-only"
              name={name}
              value={option.value}
              checked={value === option.value}
              aria-label={option.accessibleLabel}
              onChange={() => onValueChange(option.value)}
            />
            <span
              className={twMerge(
                "peer-focus-visible:ring-accent flex h-11 min-w-11 items-center justify-center rounded-md border border-transparent px-3 text-sm transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:outline-none sm:h-9",
                value === option.value
                  ? "bg-accent text-surface"
                  : "text-text-muted hover:bg-surface-muted",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
