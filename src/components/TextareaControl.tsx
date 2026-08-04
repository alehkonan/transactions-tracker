import { Field } from "@base-ui/react/field";
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
  /** Static help text, shown below the textarea in place of a validation error when there is none. */
  description?: string;
} & Omit<ComponentProps<"textarea">, "value" | "name">;

/**
 * Native `<textarea>` wired to react-hook-form via `useController`, wrapped in a
 * `Field.Root` with an optional label and its validation error. Extra props forward to `<textarea>`.
 */
export function TextareaControl<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, string>,
>({
  control,
  name,
  rules,
  label,
  description,
  className,
  onChange,
  onBlur,
  ...props
}: Props<TFieldValues, TName>) {
  const { field, fieldState } = useController({ control, name, rules });

  return (
    <Field.Root className="flex flex-col gap-1">
      {label && <Field.Label className="text-text text-sm font-bold">{label}</Field.Label>}
      <Field.Control
        render={
          <textarea
            {...props}
            {...field}
            onChange={(event) => {
              field.onChange(event);
              onChange?.(event);
            }}
            onBlur={(event) => {
              field.onBlur();
              onBlur?.(event);
            }}
            className={twMerge(
              "border-border bg-surface text-text resize-none rounded-lg border px-2 py-2",
              className,
            )}
          />
        }
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
