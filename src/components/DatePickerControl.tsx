import { Field } from "@base-ui/react/field";
import { format, set } from "date-fns";
import { useRef } from "react";
import { useController } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { DatePicker, type DatePickerActions } from "~/components/DatePicker";
import type { Control, FieldPathByValue, FieldValues, UseControllerProps } from "react-hook-form";

type Props<TFieldValues extends FieldValues, TName extends FieldPathByValue<TFieldValues, Date>> = {
  control: Control<TFieldValues>;
  name: TName;
  rules?: UseControllerProps<TFieldValues, TName>["rules"];
  label?: string;
  /** Static help text, shown below the trigger in place of a validation error when there is none. */
  description?: string;
  /** Days the calendar refuses, e.g. `{ after: new Date() }`. Forwarded to DayPicker. */
  disabled?: React.ComponentProps<typeof DatePicker>["disabled"];
};

/**
 * Single-date `DatePicker` wired to react-hook-form via `useController`, wrapped in a `Field.Root`
 * with an optional label and its validation error.
 *
 * The field holds a full `Date`: the calendar changes its day while the native time input changes
 * its hours and minutes. Each preserves the portion the other control owns.
 */
export function DatePickerControl<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, Date>,
>({ control, name, rules, label, description, disabled }: Props<TFieldValues, TName>) {
  const { field, fieldState } = useController({ control, name, rules });
  const datePicker = useRef<DatePickerActions>(null);
  const selected: Date = field.value;

  const handleSelect = (day: Date | undefined) => {
    if (!day) return;
    field.onChange(
      set(day, {
        hours: selected.getHours(),
        minutes: selected.getMinutes(),
        seconds: selected.getSeconds(),
        milliseconds: selected.getMilliseconds(),
      }),
    );
    datePicker.current?.close();
  };

  const handleTimeChange = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return;
    field.onChange(set(selected, { hours, minutes }));
  };

  return (
    <Field.Root className="flex w-full min-w-0 flex-col gap-1">
      {label && <Field.Label className="text-text text-sm font-bold">{label}</Field.Label>}
      <div className="flex w-full items-center gap-2">
        <DatePicker
          actionsRef={datePicker}
          triggerClassName="w-full justify-between"
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          label={format(selected, "d MMM yyyy")}
          defaultMonth={selected}
          disabled={disabled}
        />
        <input
          type="time"
          value={format(selected, "HH:mm")}
          onChange={(event) => handleTimeChange(event.target.value)}
          onBlur={field.onBlur}
          aria-label="Time"
          className="border-border bg-surface text-text focus-visible:ring-accent h-11 min-w-0 flex-1 rounded-2xl border px-3 text-center transition-[box-shadow,background-color,color,border-color] not-disabled:hover:shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:h-9"
        />
      </div>
      {(fieldState.error?.message ?? description) && (
        <Field.Description
          className={twMerge("text-sm", fieldState.error ? "text-danger" : "text-text-muted")}
        >
          {fieldState.error?.message ?? description}
        </Field.Description>
      )}
    </Field.Root>
  );
}
