import { useMemo, useState } from "react";
import { Button } from "~/components/Button";
import { Select } from "~/components/Select";
import { Title } from "~/components/Title";
import { actions } from "./useTransactionsImport";
import { getUniqueColumnValues } from "./utils";
import type { ParsedCsv } from "~/utils/parseCsv";

type Props = {
  csv: ParsedCsv;
};

export function CheckHeadersStep({ csv }: Props) {
  const [accountColumns, setAccountColumns] = useState<string[]>([]);
  const [categoryColumns, setCategoryColumns] = useState<string[]>([]);

  const accountValues = useMemo(
    () => (csv ? getUniqueColumnValues(csv, accountColumns) : []),
    [csv, accountColumns],
  );
  const categoryValues = useMemo(
    () => (csv ? getUniqueColumnValues(csv, categoryColumns) : []),
    [csv, categoryColumns],
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <Title variant="section">Accounts</Title>
        <div className="grid min-h-32 grid-cols-[auto_1fr] gap-4">
          <Select
            multiple
            value={accountColumns}
            onChange={(e) =>
              setAccountColumns(Array.from(e.target.selectedOptions, (o) => o.value))
            }
            options={csv.headers}
          />
          <div className="border-border bg-surface-muted flex flex-1 flex-wrap gap-2 rounded-xl border p-3">
            {accountValues.length > 0 ? (
              accountValues.map((value) => (
                <span
                  key={value}
                  className="bg-surface border-border rounded-full border px-2 py-0.5 text-sm"
                >
                  {value}
                </span>
              ))
            ) : (
              <span className="text-text-muted text-sm">Empty</span>
            )}
          </div>
        </div>
        <footer className="flex justify-end">
          <Button variant="secondary">Check in database</Button>
        </footer>
      </section>
      <section className="flex flex-col gap-2">
        <Title variant="section">Categories</Title>
        <div className="grid min-h-32 grid-cols-[auto_1fr] gap-4">
          <Select
            multiple
            value={categoryColumns}
            onChange={(e) =>
              setCategoryColumns(Array.from(e.target.selectedOptions, (o) => o.value))
            }
            options={csv.headers}
          />
          <div className="border-border bg-surface-muted flex flex-1 flex-wrap gap-2 rounded-xl border p-3">
            {categoryValues.length > 0 ? (
              categoryValues.map((value) => (
                <span
                  key={value}
                  className="bg-surface border-border rounded-full border px-2 py-0.5 text-sm"
                >
                  {value}
                </span>
              ))
            ) : (
              <span className="text-text-muted text-sm">Empty</span>
            )}
          </div>
        </div>
        <footer className="flex justify-end">
          <Button variant="secondary">Check in database</Button>
        </footer>
      </section>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button variant="secondary" onClick={actions.reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
