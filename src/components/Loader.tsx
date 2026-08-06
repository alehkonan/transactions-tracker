import { LoaderCircleIcon } from "lucide-react";

export function Loader() {
  return (
    <div className="grid place-items-center p-20">
      <LoaderCircleIcon className="size-8 animate-spin text-slate-400" aria-label="Loading" />
    </div>
  );
}
