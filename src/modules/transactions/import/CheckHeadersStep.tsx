import { useCallback } from "react";
import { checkAccountNames } from "~/api/account.functions";
import { checkCategoryNames } from "~/api/category.functions";
import { Button } from "~/components/Button";
import { CheckHeadersSection } from "./CheckHeadersSection";
import { actions } from "./useTransactionsImport";
import { getUniqueColumnValues } from "./utils";
import type { ParsedCsv } from "~/utils/parseCsv";

type Props = {
  csv: ParsedCsv;
};

export function CheckHeadersStep({ csv }: Props) {
  const getUniqueCsvValues = useCallback(
    (columns: string[]) => getUniqueColumnValues(csv, columns),
    [csv],
  );

  return (
    <div className="flex flex-col gap-4">
      <CheckHeadersSection
        title="Accounts"
        options={csv.headers}
        getValues={getUniqueCsvValues}
        bindIds={(values) => checkAccountNames({ data: values })}
      />
      <CheckHeadersSection
        title="Categories"
        options={csv.headers}
        getValues={getUniqueCsvValues}
        bindIds={(values) => checkCategoryNames({ data: values })}
      />
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button variant="secondary" onClick={actions.reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
