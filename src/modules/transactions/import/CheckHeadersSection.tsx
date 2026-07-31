import { useState } from "react";
import { Button } from "~/components/Button";
import { Chip } from "~/components/Chip";
import { Select } from "~/components/Select";
import { Title } from "~/components/Title";

type Props = {
  title: string;
  options: string[];
  getValues: (selectedOptions: string[]) => string[];
};

export function CheckHeadersSection({ title, options, getValues }: Props) {
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

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
          {getValues(selectedOptions).map((value) => (
            <Chip key={value}>{value}</Chip>
          ))}
        </div>
      </div>
      <footer className="flex justify-end">
        <Button variant="secondary">Check in database</Button>
      </footer>
    </section>
  );
}
