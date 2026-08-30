import { SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  /** Receives the query after typing has paused, so filtering a large local list stays responsive. */
  onSearchChange: (query: string) => void;
};

const SEARCH_DEBOUNCE_MS = 500;

/** A locally controlled, debounced transaction search field. */
export function TransactionsSearchInput({ onSearchChange }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => onSearchChange(value), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [onSearchChange, value]);

  return (
    <label className="relative min-w-0 flex-1">
      <span className="sr-only">Search transactions</span>
      <SearchIcon className="text-text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search transactions"
        className="border-border bg-surface text-text h-11 w-full rounded-2xl border py-2 pr-3 pl-9 sm:h-9"
      />
    </label>
  );
}
