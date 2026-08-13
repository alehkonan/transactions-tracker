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
 * The field holds a full `Date` but the calendar only picks a day, so the time of day is carried
 * across a selection rather than reset to midnight — it is what orders two entries made on the
 * same day, and the person picking a date never said anything about it.
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

  return (
    <Field.Root className="flex flex-col items-start gap-1">
      {label && <Field.Label className="text-text text-sm font-bold">{label}</Field.Label>}
      <DatePicker
        actionsRef={datePicker}
        mode="single"
        selected={selected}
        onSelect={handleSelect}
        label={format(selected, "d MMM yyyy")}
        defaultMonth={selected}
        disabled={disabled}
      />
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
