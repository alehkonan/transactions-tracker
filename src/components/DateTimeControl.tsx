import { format } from "date-fns";
import { useId } from "react";
import { useController } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import type { Control, FieldPathByValue, FieldValues, UseControllerProps } from "react-hook-form";

type Props<TFieldValues extends FieldValues, TName extends FieldPathByValue<TFieldValues, Date>> = {
  control: Control<TFieldValues>;
  name: TName;
  rules?: UseControllerProps<TFieldValues, TName>["rules"];
  label: string;
  dateLabel?: string;
  timeLabel?: string;
  description?: string;
  max?: Date;
};

const inputClassName =
  "border-border bg-surface text-text focus-visible:ring-accent h-11 min-w-0 w-full rounded-2xl border px-3 transition-[box-shadow,background-color,color,border-color] not-disabled:hover:shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:bg-surface-muted disabled:cursor-not-allowed sm:h-9";

/** Native date and time inputs that edit one local Date value. */
export function DateTimeControl<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, Date>,
>({
  control,
  name,
  rules,
  label,
  dateLabel = "Date",
  timeLabel = "Time",
  description,
  max,
}: Props<TFieldValues, TName>) {
  const generatedId = useId();
  const dateId = `${generatedId}-date`;
  const timeId = `${generatedId}-time`;
  const descriptionId = `${generatedId}-description`;
  const { field, fieldState } = useController({ control, name, rules });
  const selected: Date = field.value;
  const supportingText = fieldState.error?.message ?? description;
  const maxDate = max ? format(max, "yyyy-MM-dd") : undefined;
  const selectedDate = format(selected, "yyyy-MM-dd");

  const handleDateChange = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return;
    const next = new Date(selected);
    next.setFullYear(year, month - 1, day);
    field.onChange(next);
  };

  const handleTimeChange = (value: string) => {
    const [hours, minutes] = value.split(":").map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return;
    const next = new Date(selected);
    next.setHours(hours, minutes, 0, 0);
    field.onChange(next);
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="text-text text-sm font-bold">{label}</legend>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.5fr)]">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={dateId} className="text-text-muted text-xs font-semibold">
            {dateLabel}
          </label>
          <input
            ref={field.ref}
            id={dateId}
            type="date"
            value={selectedDate}
            max={maxDate}
            disabled={field.disabled}
            aria-invalid={fieldState.invalid || undefined}
            aria-describedby={supportingText ? descriptionId : undefined}
            onChange={(event) => handleDateChange(event.currentTarget.value)}
            onBlur={field.onBlur}
            className={inputClassName}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={timeId} className="text-text-muted text-xs font-semibold">
            {timeLabel}
          </label>
          <input
            id={timeId}
            type="time"
            value={format(selected, "HH:mm")}
            step={60}
            disabled={field.disabled}
            aria-invalid={fieldState.invalid || undefined}
            aria-describedby={supportingText ? descriptionId : undefined}
            onChange={(event) => handleTimeChange(event.currentTarget.value)}
            onBlur={field.onBlur}
            className={inputClassName}
          />
        </div>
      </div>
      {supportingText && (
        <p
          id={descriptionId}
          className={twMerge("text-sm", fieldState.error ? "text-danger" : "text-text-muted")}
        >
          {supportingText}
        </p>
      )}
    </fieldset>
  );
}
