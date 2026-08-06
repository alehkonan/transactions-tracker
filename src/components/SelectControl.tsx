import { Field } from "@base-ui/react/field";
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
  /** Static help text, shown below the select in place of a validation error when there is none. */
  description?: string;
} & Pick<
  ComponentProps<typeof Select>,
  "options" | "placeholder" | "id" | "className" | "required"
>;

/**
 * Single-select `Select` wired to react-hook-form via `useController`, wrapped in a
 * `Field.Root` with an optional label and its validation error. Extra props forward to `Select`.
 */
export function SelectControl<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, string>,
>({ control, name, rules, label, description, ...props }: Props<TFieldValues, TName>) {
  const { field, fieldState } = useController({ control, name, rules });

  return (
    <Field.Root className="flex flex-col gap-1">
      {label && <Field.Label className="text-text text-sm font-bold">{label}</Field.Label>}
      <Select
        {...props}
        name={name}
        value={field.value}
        onValueChange={(value) => field.onChange(value ?? "")}
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
