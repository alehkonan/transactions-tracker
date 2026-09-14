import { LoaderCircleIcon } from "lucide-react";
import { PwaRecoveryLink } from "~/modules/pwa/PwaRecoveryLink";

export function Loader() {
  return (
    <div className="grid place-items-center gap-3 p-20 text-center">
      <output>
        <LoaderCircleIcon aria-hidden="true" className="text-accent size-8 animate-spin" />
        <span className="sr-only">Loading…</span>
      </output>
      <PwaRecoveryLink />
    </div>
  );
}
