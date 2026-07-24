import { type Column, Table } from "~/components/Table";
import { Title } from "~/components/Title";
import { type ParsedCsv } from "~/utils/parseCsv";
import { columnLabel } from "./columnLabel";

const PREVIEW_ROWS = 5;

type Props = {
  csv: ParsedCsv;
};

/** Shows the first few rows of a parsed CSV in a table. */
export function CsvPreview({ csv }: Props) {
  const { headers, rows } = csv;
  const previewRows = rows.slice(0, PREVIEW_ROWS);

  const columns: Column<string[]>[] = headers.map((header, index) => ({
    key: String(index),
    header: columnLabel(header, index),
    cell: (row) => row[index] ?? "",
  }));

  return (
    <section className="flex flex-col gap-2">
      <Title variant="section">{`Preview — first ${previewRows.length} of ${rows.length} rows`}</Title>
      <Table data={previewRows} columns={columns} />
    </section>
  );
}
