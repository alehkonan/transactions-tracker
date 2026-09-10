import { LoaderCircleIcon } from "lucide-react";

export function Loader() {
  return (
    <output className="grid place-items-center p-20">
      <LoaderCircleIcon aria-hidden="true" className="text-accent size-8 animate-spin" />
      <span className="sr-only">Loading…</span>
    </output>
  );
}
