import { useEffect, useState, useTransition } from "react";
import { twJoin } from "tailwind-merge";
import { Button } from "~/components/Button";
import { Chip } from "~/components/Chip";
import { Select } from "~/components/Select";
import { Title } from "~/components/Title";
import type { Bindings } from "./useTransactionsImport";

type Props = {
  title: string;
  options: string[];
  getValues: (selectedOptions: string[]) => string[];
  bindings: Bindings;
  onBindingsChange: (bindings: Bindings) => void;
  bindIds: (bindings: Bindings) => Promise<Bindings>;
  createMissing: (names: string[]) => Promise<{ id: number; name: string }[]>;
};

export function CheckHeadersSection({
  title,
  options,
  getValues,
  bindings,
  onBindingsChange,
  bindIds,
  createMissing,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    const initialBindings = Object.fromEntries(
      getValues(selectedOptions).map((value) => [value, undefined]),
    );
    onBindingsChange(initialBindings);
    setHasChecked(false);

    if (Object.keys(initialBindings).length === 0) return;

    startTransition(async () => {
      onBindingsChange(await bindIds(initialBindings));
      setHasChecked(true);
    });
  }, [selectedOptions, getValues, bindIds, onBindingsChange]);

  const missingNames = Object.entries(bindings)
    .filter(([, id]) => id === undefined)
    .map(([name]) => name);

  const handleCreateMissing = () => {
    startTransition(async () => {
      const created = await createMissing(missingNames);
      onBindingsChange({
        ...bindings,
        ...Object.fromEntries(created.map(({ id, name }) => [name, id])),
      });
    });
  };

  return (
    <section className="flex flex-col gap-2">
      <Title variant="section">{title}</Title>
      <div className="grid h-48 gap-4 sm:grid-cols-[auto_1fr]">
        <Select
          multiple
          value={selectedOptions}
          onChange={(e) => setSelectedOptions(Array.from(e.target.selectedOptions, (o) => o.value))}
          options={options}
        />
        <div className="border-border bg-surface-muted flex flex-1 flex-wrap content-start items-start gap-2 overflow-auto rounded-xl border p-3">
          {Object.keys(bindings).map((value) => (
            <Chip
              key={value}
              className={twJoin(
                bindings[value] ? "border-accent text-accent" : "text-text-muted border-dashed",
              )}
            >
              {value}
            </Chip>
          ))}
        </div>
      </div>
      <footer className="flex justify-end">
        <Button
          variant="secondary"
          disabled={isPending || !hasChecked || missingNames.length === 0}
          onClick={handleCreateMissing}
        >
          Add missing ({missingNames.length})
        </Button>
      </footer>
    </section>
  );
}
