import { SearchIcon, XIcon } from "lucide-react";
import { twJoin } from "tailwind-merge";

type Props = {
  value: string;
  onValueChange: (query: string) => void;
};

/** A controlled transaction search field; the route defers the expensive local filtering. */
export function TransactionsSearchInput({ value, onValueChange }: Props) {
  return (
    <div className="relative min-w-0 flex-1">
      <label htmlFor="transaction-search" className="sr-only">
        Search transactions
      </label>
      <SearchIcon className="text-text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <input
        id="transaction-search"
        name="transaction-search"
        type="search"
        aria-keyshortcuts="/"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Search transactions"
        className={twJoin(
          "border-border bg-surface text-text focus-visible:ring-accent h-11 w-full rounded-2xl border py-2 pl-9 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none md:h-9",
          value ? "pr-10" : "pr-3",
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onValueChange("")}
          aria-label="Clear transaction search"
          className="text-text-muted hover:bg-surface-muted hover:text-text focus-visible:ring-accent absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center rounded-2xl transition-colors focus-visible:ring-2 focus-visible:outline-none md:right-1.5 md:size-8 md:rounded-full"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
