import { LoaderCircleIcon } from "lucide-react";
import { PwaRecoveryLink } from "~/modules/pwa/PwaRecoveryLink";

export function Loader({ label = "Loading app…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <output className="text-text-muted flex flex-col items-center gap-3 text-sm">
        <LoaderCircleIcon
          aria-hidden="true"
          className="size-6 animate-spin motion-reduce:animate-none"
        />
        <span>{label}</span>
      </output>
      <PwaRecoveryLink />
    </div>
  );
}
