import {
  DayPicker,
  UI,
  type ChevronProps,
  type ClassNames,
  type DayButtonProps,
  type DayPickerProps,
} from "@daypicker/react";
import { CalendarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { twJoin, twMerge } from "tailwind-merge";
import { Button } from "./Button";

const navButtonClassName = twJoin(
  "border-border rounded-lg border",
  "size-7 shrink-0 place-items-center",
  "disabled:opacity-40",
);

const classNames: Partial<ClassNames> = {
  [UI.PreviousMonthButton]: navButtonClassName,
  [UI.NextMonthButton]: navButtonClassName,
  [UI.Month]: "grid grid-cols-[auto_1fr_auto] items-center gap-x-1",
  [UI.Dropdowns]: "flex items-center gap-1",
  [UI.Dropdown]: "border border-border h-7 rounded-lg text-sm",
  [UI.MonthsDropdown]: "w-24",
  [UI.YearsDropdown]: "w-16",
  [UI.CaptionLabel]: "hidden",
  [UI.MonthGrid]: "col-span-3",
  [UI.Weekday]: "text-text-muted pt-2 text-xs",
  [UI.Day]: "group text-sm py-1",
  [UI.DayButton]: twJoin(
    "size-7 rounded-xl",
    "hover:bg-surface-muted transition-colors",
    "disabled:pointer-events-none disabled:opacity-40",
    "group-data-outside:text-text-muted/50",
    "group-data-selected:bg-accent group-data-selected:text-surface",
    "group-data-selected:hover:bg-accent",
  ),
};

type Props = DayPickerProps & {
  label?: string;
};

export function DatePicker({ label, ...props }: Props) {
  const panelId = useId();

  return (
    <>
      <Button variant="secondary" popoverTarget={panelId}>
        <CalendarIcon className="size-4" />
        <span className="truncate">{label ?? "Select date"}</span>
      </Button>
      <div
        id={panelId}
        popover="hint"
        className={twJoin(
          "popover",
          "border-border bg-surface m-1 rounded-xl border p-2 shadow-lg",
        )}
      >
        <DayPicker
          classNames={classNames}
          components={{ Chevron, DayButton }}
          captionLayout="dropdown"
          navLayout="around"
          {...props}
        />
      </div>
    </>
  );
}

function Chevron({ orientation, className }: ChevronProps) {
  const Icon =
    orientation === "left"
      ? ChevronLeftIcon
      : orientation === "right"
        ? ChevronRightIcon
        : ChevronDownIcon;
  return <Icon className={twMerge("size-4", className)} />;
}

function DayButton({ day: _day, modifiers, className, children, ...props }: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <button ref={ref} type="button" className={className} {...props}>
      <span className="relative">
        {children}
        {modifiers.today && !modifiers.selected && (
          <span className="bg-accent absolute inset-x-0 -bottom-1.5 mx-auto block size-1 rounded-full" />
        )}
      </span>
    </button>
  );
}
