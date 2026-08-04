import { Select } from "~/components/Select";
import { getMappedValue } from "./utils";
import type { Bindings, ColumnMapping } from "./useTransactionsImport";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import type { ParsedCsv } from "~/utils/parseCsv";

type MappableColumn = keyof ColumnMapping;

type Params = {
  csv: ParsedCsv;
  columnMapping: ColumnMapping;
  accountBindings: Bindings;
  categoryBindings: Bindings;
  onMappingChange: (column: MappableColumn, header: string | undefined) => void;
};

function HeaderCell({
  label,
  csv,
  value,
  onChange,
}: {
  label: string;
  csv: ParsedCsv;
  value: string | undefined;
  onChange: (header: string | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1 py-1 text-left font-normal">
      <span>{label}</span>
      <Select
        value={value}
        placeholder="Not mapped"
        onValueChange={onChange}
        options={csv.headers}
      />
    </div>
  );
}

export function getMapColumnsTableColumns({
  csv,
  columnMapping,
  accountBindings,
  categoryBindings,
  onMappingChange,
}: Params): ColumnDef<string[]>[] {
  const mappedCell =
    (column: MappableColumn) =>
    ({ row }: CellContext<string[], unknown>) =>
      getMappedValue(csv, row.original, columnMapping[column]) ?? "—";

  const boundCell =
    (column: MappableColumn, bindings: Bindings) =>
    ({ row }: CellContext<string[], unknown>) => {
      const value = getMappedValue(csv, row.original, columnMapping[column]);
      if (value === undefined) return "—";
      const id = bindings[value];
      return id ?? `${value} (unbound)`;
    };

  return [
    {
      id: "createdAt",
      header: () => (
        <HeaderCell
          label="Datetime"
          csv={csv}
          value={columnMapping.createdAt}
          onChange={(header) => onMappingChange("createdAt", header)}
        />
      ),
      cell: mappedCell("createdAt"),
    },
    {
      id: "category",
      header: () => (
        <HeaderCell
          label="Category"
          csv={csv}
          value={columnMapping.category}
          onChange={(header) => onMappingChange("category", header)}
        />
      ),
      cell: boundCell("category", categoryBindings),
    },
    {
      id: "necessityLevel",
      header: () => (
        <HeaderCell
          label="Necessity"
          csv={csv}
          value={columnMapping.necessityLevel}
          onChange={(header) => onMappingChange("necessityLevel", header)}
        />
      ),
      cell: mappedCell("necessityLevel"),
    },
    {
      id: "income",
      header: "From",
      columns: [
        {
          id: "incomeAccountId",
          header: () => (
            <HeaderCell
              label="Account"
              csv={csv}
              value={columnMapping.incomeAccountId}
              onChange={(header) => onMappingChange("incomeAccountId", header)}
            />
          ),
          cell: boundCell("incomeAccountId", accountBindings),
        },
        {
          id: "incomeAmount",
          header: () => (
            <HeaderCell
              label="Amount"
              csv={csv}
              value={columnMapping.incomeAmount}
              onChange={(header) => onMappingChange("incomeAmount", header)}
            />
          ),
          cell: mappedCell("incomeAmount"),
        },
      ],
    },
    {
      id: "to",
      header: "To",
      columns: [
        {
          id: "outcomeAccountId",
          header: () => (
            <HeaderCell
              label="Account"
              csv={csv}
              value={columnMapping.outcomeAccountId}
              onChange={(header) => onMappingChange("outcomeAccountId", header)}
            />
          ),
          cell: boundCell("outcomeAccountId", accountBindings),
        },
        {
          id: "outcomeAmount",
          header: () => (
            <HeaderCell
              label="Amount"
              csv={csv}
              value={columnMapping.outcomeAmount}
              onChange={(header) => onMappingChange("outcomeAmount", header)}
            />
          ),
          cell: mappedCell("outcomeAmount"),
        },
      ],
    },
  ];
}
