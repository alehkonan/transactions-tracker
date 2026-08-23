# Import Mapping and Statement Dialects Plan

Make CSV import usable with real bank exports by adding a column-mapping step and explicit amount/date
dialect parsing while keeping the existing pure import-plan pipeline. Read `docs/architecture.md`
first — importing remains a local-first write over the replicated working set.

## Scope

- [ ] `guess-mapping.ts` (+ test) — headers → best-guess field mapping, with aliases
- [ ] A `MappingStep` in the wizard, with a live preview of the first data row
- [ ] Amount and date dialect parsing, extracted into testable helpers (+ tests)

### What exists today

The wizard is two steps (`upload` → `processing`) and the mapping is rigid: `IMPORT_HEADERS`'
nine names must appear verbatim (`getMissingHeaders` rejects otherwise), `csvToImportRows` reads
by exact header name, amounts go through `parseAmount`'s single `replace(",", ".")`, and dates
go through `new Date(...)` and the browser's goodwill. `parseCsv` itself is already good —
RFC-4180 quoting, BOM, CRLF, and delimiter auto-detection over `,`/`;`/tab. `buildImportPlan`
is a pure function over `ImportRow[]`, which is the seam this whole item exploits: **mapping
becomes a step that produces `ImportRow[]` from any column layout, and everything downstream is
untouched.**

### Design

- **The mapping state**: `mapping: Record<ImportField, number | null>` — file column index per
  import field — added to `useTransactionsImport` alongside `rows`. An unmapped optional field
  reads as `""`, which flows through the existing per-row validation unchanged (a row with no
  mapped amounts fails as "Both income and outcome are empty or zero" — correct, and already
  worded).
- **Auto-guess**: `guessMapping(headers)` scores each header against a small alias table per
  field (case-insensitive, trimmed): `date|created|booking_date|time` → `createdDate`;
  `amount_out|debit|spent|outcome|withdrawal` → `outcome`; `amount_in|credit|income|deposit` →
  `income`; `account|from|source|account_from` → `outcomeAccountName`; and so on for the nine.
  Exact match wins, aliases fill the rest, everything else starts unmapped. A one-time
  hand-written alias table beats a fuzzy-scoring dependency; the user corrects the rest.
- **`MappingStep` between upload and processing**: one `Select` per import field (the repo's
  Base UI `Select`, the transaction form's currency/account pickers as the pattern), a required
  set enforced before **Import** enables (`createdDate` + one of the amount fields + its
  account), and **the first data row rendered live under the mapping** — "here is what row 1
  will become" is worth more than any label. `UploadStep` stops rejecting missing headers; a
  file that parses as CSV always proceeds to mapping, which is where a genuinely unusable file
  now shows itself.
- **Amount dialects** — the real blocker for European statements today: `parseAmount`'s
  `replace(",", ".")` turns `"1.234,56"` into `NaN` and the row fails. Extract a
  `parseAmountCell(raw, dialect)` into the import module with two dialects — `1,234.56` and
  `1.234,56` — auto-detected per file (scan the amount columns; a cell matching
  `/^\d{1,3}([.,]\d{3})+[.,]\d{2}$/` names its own dialect by its last separator) with a manual
  override on the mapping step next to the preview. Detection is a pure function over the
  parsed columns → unit-tested; `buildImportPlan` gains a `dialect` field in its context and
  stays pure.
- **Date dialects** — same shape: a `parseDateCell(raw, format)` trying a candidate list
  (`yyyy-MM-dd`, `dd/MM/yyyy`, `MM/dd/yyyy`, `dd.MM.yyyy`, ISO) via date-fns' `parse` with a
  strict reference date, auto-guessed (the first parseable format across the column wins) and
  overridable on the mapping step. `dd/MM` vs `MM/dd` stays genuinely ambiguous — detection
  picks `dd/MM` when any cell's first number exceeds 12, else defaults and says so in the UI.
  Ambiguity is disclosed, never silently resolved.
- **Out of scope**: OFX / QIF / Camt.053. Real work (XML parsing, per-bank dialects) for a
  payoff that is mostly "the same rows, a different wrapper" — and CSV export is universal in
  banking UIs. The mapping step plus dialects is what unblocks real statements; revisit binary
  formats only if a specific bank makes it a real requirement rather than a hypothetical.

### Verification

`guess-mapping.test.ts`, `parse-amount`/`parse-date` helper tests (dialect detection including the
ambiguous cases, `1.234,56`, thousands-with-decimal-cents, empty = zero), and the existing
`build-import-plan.test.ts` extended for the dialect field. Manual pass with
`samples/transactions.csv` and — the point of the item — a real bank export renamed and
re-ordered, mapped by hand in under a minute.
