import { useId } from "react";
import { useController } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";
import type { Control, FieldPathByValue, FieldValues, UseControllerProps } from "react-hook-form";

type Props<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, string>,
> = {
  control: Control<TFieldValues>;
  name: TName;
  rules?: UseControllerProps<TFieldValues, TName>["rules"];
  label?: string;
  /** Static help text, shown below the input when there is no validation error. */
  description?: string;
} & Omit<ComponentProps<"input">, "defaultValue" | "name" | "value">;

/** Native input wired to react-hook-form with an associated label and message. */
export function InputControl<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, string>,
>({
  control,
  name,
  rules,
  label,
  description,
  id,
  className,
  onChange,
  onBlur,
  "aria-describedby": ariaDescribedBy,
  ...props
}: Props<TFieldValues, TName>) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;
  const { field, fieldState } = useController({ control, name, rules });
  const supportingText = fieldState.error?.message ?? description;
  const describedBy =
    [ariaDescribedBy, supportingText ? descriptionId : undefined].filter(Boolean).join(" ") ||
    undefined;
  const isUsername = props.autoComplete?.includes("username");

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label && (
        <label htmlFor={controlId} className="text-text text-sm font-bold">
          {label}
        </label>
      )}
      <input
        {...props}
        id={controlId}
        ref={field.ref}
        name={field.name}
        value={field.value ?? ""}
        disabled={field.disabled || props.disabled}
        autoCapitalize={props.autoCapitalize ?? (isUsername ? "none" : undefined)}
        spellCheck={props.spellCheck ?? (isUsername ? false : undefined)}
        aria-required={Boolean(rules?.required) || props.required || undefined}
        aria-invalid={fieldState.invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          const value =
            props.inputMode === "decimal"
              ? event.currentTarget.value.replace(/,/g, ".")
              : event.currentTarget.value;

          if (value !== event.currentTarget.value) event.currentTarget.value = value;
          field.onChange(value);
          onChange?.(event);
        }}
        onBlur={(event) => {
          field.onBlur();
          onBlur?.(event);
        }}
        className={twMerge(
          "border-border bg-surface text-text h-11 rounded-2xl border px-3 sm:h-9",
          "transition-[box-shadow,background-color,color,border-color] not-disabled:hover:shadow",
          "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          "disabled:bg-surface-muted disabled:cursor-not-allowed",
          className,
        )}
      />
      {supportingText && (
        <p
          id={descriptionId}
          className={twMerge("text-sm", fieldState.error ? "text-danger" : "text-text-muted")}
        >
          {supportingText}
        </p>
      )}
    </div>
  );
}
