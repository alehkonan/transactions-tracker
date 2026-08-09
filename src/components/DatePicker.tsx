import {
  DayPicker,
  UI,
  type ChevronProps,
  type ClassNames,
  type DayButtonProps,
  type DayPickerProps,
} from "@daypicker/react";
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useImperativeHandle, useRef, type RefObject } from "react";
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

export type DatePickerActions = {
  close: () => void;
};

type Props = DayPickerProps & {
  label?: string;
  /**
   * Renders a small reset chip inside the trigger. Omit it (e.g. when nothing is selected) to
   * hide the chip entirely.
   */
  onReset?: () => void;
  /**
   * Imperative handle for the calendar panel, e.g. `actionsRef.current?.close()` to dismiss it
   * once `onSelect` reports a complete selection.
   */
  actionsRef?: RefObject<DatePickerActions | null>;
};

export function DatePicker({ label, onReset, actionsRef, ...props }: Props) {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(actionsRef, () => ({
    // `hidePopover()` throws on an already-hidden popover, so only call it while it's open.
    close: () => {
      if (panelRef.current?.matches(":popover-open")) panelRef.current.hidePopover();
    },
  }));

  return (
    <>
      {/* The chip sits on top of the trigger rather than inside it: nesting a button in a
          button is invalid HTML, and its click would also open the popover. */}
      <span className="relative inline-flex">
        <Button variant="secondary" popoverTarget={panelId} className={twJoin(onReset && "pr-9")}>
          <CalendarIcon className="size-4" />
          <span className="truncate">{label ?? "Select date"}</span>
        </Button>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            aria-label="Reset selection"
            className={twJoin(
              "absolute top-1/2 right-2 -translate-y-1/2",
              "bg-surface-muted hover:bg-surface-active text-text-muted hover:text-text",
              "grid size-5 place-items-center rounded-full transition-colors",
            )}
          >
            <XIcon className="size-3" />
          </button>
        )}
      </span>
      <div
        ref={panelRef}
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
