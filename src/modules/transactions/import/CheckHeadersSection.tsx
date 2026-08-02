import { useEffect, useState, useTransition } from "react";
import { twJoin } from "tailwind-merge";
import { Button } from "~/components/Button";
import { Chip } from "~/components/Chip";
import { Select } from "~/components/Select";
import { Title } from "~/components/Title";

type Bindings = Record<string, number | undefined>;

type Props = {
  title: string;
  options: string[];
  getValues: (selectedOptions: string[]) => string[];
  bindIds: (bindings: Bindings) => Promise<Bindings>;
};

export function CheckHeadersSection({ title, options, getValues, bindIds }: Props) {
  const [isPending, startTransition] = useTransition();
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [bindings, setBindings] = useState<Bindings>({});

  useEffect(() => {
    setBindings(Object.fromEntries(getValues(selectedOptions).map((value) => [value, undefined])));
  }, [selectedOptions, getValues]);

  const handleCheck = () => {
    startTransition(async () => {
      setBindings(await bindIds(bindings));
    });
  };

  return (
    <section className="flex flex-col gap-2">
      <Title variant="section">{title}</Title>
      <div className="grid h-48 gap-4 sm:grid-cols-[auto_1fr]">
        <Select
          multiple
          value={selectedOptions}
          onChange={(e) => {
            setSelectedOptions(Array.from(e.target.selectedOptions, (o) => o.value));
            setBindings({});
          }}
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
        <Button variant="secondary" disabled={isPending} onClick={handleCheck}>
          {isPending ? "Checking…" : "Check in database"}
        </Button>
      </footer>
    </section>
  );
}
