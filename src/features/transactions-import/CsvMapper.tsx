import { type ChangeEvent, type Dispatch, type SetStateAction, useCallback, useMemo } from "react";
import { Select, type SelectOption } from "~/components/Select";
import { Title } from "~/components/Title";
import { columnLabel } from "./columnLabel";
import { transactionFields } from "./transactionFields";

export type ColumnMapping = Record<string, string>;

type Props = {
  headers: string[];
  mapping: ColumnMapping;
  onMappingChange: Dispatch<SetStateAction<ColumnMapping>>;
};

/** Lets the user map each transaction field to a CSV column. */
export function CsvMapper({ headers, mapping, onMappingChange }: Props) {
  const options = useMemo<SelectOption[]>(
    () =>
      headers.map((header, index) => ({ value: String(index), label: columnLabel(header, index) })),
    [headers],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const { name, value } = event.target;
      onMappingChange((prev) => ({ ...prev, [name]: value }));
    },
    [onMappingChange],
  );

  return (
    <section className="flex flex-col gap-2">
      <Title variant="section">Map CSV columns to transaction fields</Title>
      <div className="grid gap-3 sm:grid-cols-2">
        {transactionFields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="text-text text-sm">
              {field.label}
              {field.required && <span className="text-accent"> *</span>}
            </span>
            <Select
              name={field.key}
              value={mapping[field.key] ?? ""}
              onChange={handleChange}
              options={options}
              placeholder={field.required ? "Select a column" : "—"}
              placeholderDisabled={field.required}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
