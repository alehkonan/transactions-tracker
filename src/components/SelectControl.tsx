import { useId } from "react";
import { useController } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import { Select } from "~/components/Select";
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
  /** Static help text, shown below the select when there is no validation error. */
  description?: string;
} & Omit<ComponentProps<typeof Select>, "name" | "onValueChange" | "value">;

/** Native single-select wired to react-hook-form with an associated label and message. */
export function SelectControl<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, string>,
>({ control, name, rules, label, description, id, ...props }: Props<TFieldValues, TName>) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = `${controlId}-description`;
  const { field, fieldState } = useController({ control, name, rules });
  const supportingText = fieldState.error?.message ?? description;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label && (
        <label htmlFor={controlId} className="text-text text-sm font-bold">
          {label}
        </label>
      )}
      <Select
        {...props}
        id={controlId}
        ref={field.ref}
        name={field.name}
        value={field.value}
        onValueChange={(value) => field.onChange(value ?? "")}
        onBlur={field.onBlur}
        disabled={field.disabled || props.disabled}
        placeholderDisabled={props.placeholderDisabled ?? Boolean(rules?.required)}
        aria-required={Boolean(rules?.required) || props.required || undefined}
        aria-invalid={fieldState.invalid || undefined}
        aria-describedby={supportingText ? descriptionId : undefined}
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
