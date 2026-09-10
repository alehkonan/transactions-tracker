import { useId, type ReactNode } from "react";
import { useController } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import type { Control, FieldPathByValue, FieldValues, UseControllerProps } from "react-hook-form";

export type RadioOption = {
  value: string;
  label: string;
  content?: ReactNode;
};

type Props<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, string>,
> = {
  control: Control<TFieldValues>;
  name: TName;
  rules?: UseControllerProps<TFieldValues, TName>["rules"];
  label: string;
  hideLabel?: boolean;
  description?: string;
  options: readonly RadioOption[];
  className?: string;
  optionClassName?: string | ((option: RadioOption, checked: boolean) => string);
};

/** Native single-choice radio group styled as a segmented control. */
export function RadioGroupControl<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, string>,
>({
  control,
  name,
  rules,
  label,
  hideLabel,
  description,
  options,
  className,
  optionClassName,
}: Props<TFieldValues, TName>) {
  const generatedId = useId();
  const descriptionId = `${generatedId}-description`;
  const { field, fieldState } = useController({ control, name, rules });
  const supportingText = fieldState.error?.message ?? description;

  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className={hideLabel ? "sr-only" : "text-text text-sm font-bold"}>{label}</legend>
      <div className={className}>
        {options.map((option, index) => {
          const checked = field.value === option.value;
          const customClassName =
            typeof optionClassName === "function"
              ? optionClassName(option, checked)
              : optionClassName;

          return (
            <label key={option.value} className="flex min-w-0 flex-1 cursor-pointer">
              <input
                ref={index === 0 ? field.ref : undefined}
                type="radio"
                className="peer sr-only"
                name={field.name}
                value={option.value}
                checked={checked}
                disabled={field.disabled}
                aria-describedby={supportingText ? descriptionId : undefined}
                onChange={() => field.onChange(option.value)}
                onBlur={field.onBlur}
              />
              <span
                className={twMerge(
                  "focus-visible:ring-accent flex min-w-0 flex-1 items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:outline-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
                  customClassName,
                )}
              >
                {option.content ?? option.label}
              </span>
            </label>
          );
        })}
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
