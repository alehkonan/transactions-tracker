import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { twMerge } from "tailwind-merge";
import type { AveragePeriod } from "~/modules/statistics/compute-daily-averages";

const options: { value: AveragePeriod; label: string }[] = [
  { value: "3m", label: "3M" },
  { value: "6m", label: "6M" },
  { value: "1y", label: "1Y" },
];

type Props = {
  value: AveragePeriod;
  onValueChange: (period: AveragePeriod) => void;
};

/** Picks the trailing window the per-day averages are computed over. */
export function AveragePeriodToggle({ value, onValueChange }: Props) {
  return (
    <ToggleGroup
      aria-label="Spending history used for runway and daily averages"
      value={[value]}
      // Base UI clears the group when the pressed item is toggled off; keep the
      // current period instead, since exactly one has to stay selected.
      onValueChange={([next]) => onValueChange((next as AveragePeriod) ?? value)}
      className="border-border bg-surface flex shrink-0 items-center gap-1 rounded-lg border p-1"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          aria-label={`${option.label}: last ${option.value === "1y" ? "year" : option.value === "6m" ? "6 months" : "3 months"}`}
          className={(toggleState) =>
            twMerge(
              "h-11 min-w-11 rounded-md border border-transparent px-3 text-sm transition-colors sm:h-9",
              toggleState.pressed
                ? "bg-accent text-surface"
                : "text-text-muted hover:bg-surface-muted",
            )
          }
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
