import { useCallback } from "react";
import { checkAccountNames, createAccountNames } from "~/api/account.functions";
import { checkCategoryNames, createCategoryNames } from "~/api/category.functions";
import { Button } from "~/components/Button";
import { CheckHeadersSection } from "./CheckHeadersSection";
import { actions, useTransactionsImport, type Bindings } from "./useTransactionsImport";
import { getUniqueColumnValues } from "./utils";
import type { ParsedCsv } from "~/utils/parseCsv";

type Props = {
  csv: ParsedCsv;
};

function isFullyBound(bindings: Bindings) {
  const values = Object.values(bindings);
  return values.length > 0 && values.every((id) => id !== undefined);
}

export function CheckHeadersStep({ csv }: Props) {
  const accountBindings = useTransactionsImport((state) => state.accountBindings);
  const categoryBindings = useTransactionsImport((state) => state.categoryBindings);

  const getUniqueCsvValues = useCallback(
    (columns: string[]) => getUniqueColumnValues(csv, columns),
    [csv],
  );

  const bindAccountIds = useCallback((values: Bindings) => checkAccountNames({ data: values }), []);
  const createMissingAccounts = useCallback(
    (names: string[]) => createAccountNames({ data: names }),
    [],
  );
  const bindCategoryIds = useCallback(
    (values: Bindings) => checkCategoryNames({ data: values }),
    [],
  );
  const createMissingCategories = useCallback(
    (names: string[]) => createCategoryNames({ data: names }),
    [],
  );

  const canProceed = isFullyBound(accountBindings) && isFullyBound(categoryBindings);

  return (
    <div className="flex flex-col gap-4">
      <CheckHeadersSection
        title="Accounts"
        options={csv.headers}
        getValues={getUniqueCsvValues}
        bindings={accountBindings}
        onBindingsChange={actions.setAccountBindings}
        bindIds={bindAccountIds}
        createMissing={createMissingAccounts}
      />
      <CheckHeadersSection
        title="Categories"
        options={csv.headers}
        getValues={getUniqueCsvValues}
        bindings={categoryBindings}
        onBindingsChange={actions.setCategoryBindings}
        bindIds={bindCategoryIds}
        createMissing={createMissingCategories}
      />
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button variant="secondary" onClick={actions.reset}>
          Reset
        </Button>
        <Button variant="primary" disabled={!canProceed}>
          Proceed
        </Button>
      </div>
    </div>
  );
}
