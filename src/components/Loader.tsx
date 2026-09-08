import { LoaderCircleIcon } from "lucide-react";

export function Loader() {
  return (
    <div className="grid place-items-center p-20">
      <LoaderCircleIcon className="text-accent size-8 animate-spin" aria-label="Loading" />
    </div>
  );
}
