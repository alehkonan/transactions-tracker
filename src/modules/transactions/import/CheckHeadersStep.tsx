import { Button } from "~/components/Button";
import { CheckHeadersSection } from "./CheckHeadersSection";
import { actions } from "./useTransactionsImport";
import { getUniqueColumnValues } from "./utils";
import type { ParsedCsv } from "~/utils/parseCsv";

type Props = {
  csv: ParsedCsv;
};

export function CheckHeadersStep({ csv }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <CheckHeadersSection
        title="Accounts"
        options={csv.headers}
        getValues={(columns) => getUniqueColumnValues(csv, columns)}
      />
      <CheckHeadersSection
        title="Categories"
        options={csv.headers}
        getValues={(columns) => getUniqueColumnValues(csv, columns)}
      />
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button variant="secondary" onClick={actions.reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
