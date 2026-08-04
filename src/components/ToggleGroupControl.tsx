import { Field } from "@base-ui/react/field";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useController } from "react-hook-form";
import { twMerge } from "tailwind-merge";
import type { Control, FieldPathByValue, FieldValues, UseControllerProps } from "react-hook-form";

type Props<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, string>,
> = {
  control: Control<TFieldValues>;
  name: TName;
  rules?: UseControllerProps<TFieldValues, TName>["rules"];
  label?: string;
  /** Static help text, shown below the toggle group in place of a validation error when there is none. */
  description?: string;
} & Omit<ToggleGroup.Props, "value" | "onValueChange" | "defaultValue" | "multiple">;

/**
 * Single-select `ToggleGroup` wired to react-hook-form via `useController`, wrapped in a
 * `Field.Root` with an optional label and its validation error.
 * Extra props (including `children` — the `Toggle` items) forward to `ToggleGroup`.
 */
export function ToggleGroupControl<
  TFieldValues extends FieldValues,
  TName extends FieldPathByValue<TFieldValues, string>,
>({ control, name, rules, label, description, ...props }: Props<TFieldValues, TName>) {
  const { field, fieldState } = useController({ control, name, rules });

  return (
    <Field.Root className="flex flex-col gap-1">
      {label && <Field.Label className="text-text text-sm font-bold">{label}</Field.Label>}
      <ToggleGroup
        {...props}
        value={field.value ? [field.value] : []}
        onValueChange={([value]) => field.onChange(value ?? "")}
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
