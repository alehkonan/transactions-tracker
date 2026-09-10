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
  /** Static help text, shown below the textarea when there is no validation error. */
  description?: string;
} & Omit<ComponentProps<"textarea">, "defaultValue" | "name" | "value">;

/** Native textarea wired to react-hook-form with an associated label and message. */
export function TextareaControl<
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

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label && (
        <label htmlFor={controlId} className="text-text text-sm font-bold">
          {label}
        </label>
      )}
      <textarea
        {...props}
        id={controlId}
        ref={field.ref}
        name={field.name}
        value={field.value ?? ""}
        disabled={field.disabled || props.disabled}
        autoCapitalize={props.autoCapitalize ?? "sentences"}
        spellCheck={props.spellCheck ?? true}
        aria-required={Boolean(rules?.required) || props.required || undefined}
        aria-invalid={fieldState.invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          field.onChange(event.currentTarget.value);
          onChange?.(event);
        }}
        onBlur={(event) => {
          field.onBlur();
          onBlur?.(event);
        }}
        className={twMerge(
          "border-border bg-surface text-text min-h-11 resize-y rounded-xl border px-3 py-2",
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
