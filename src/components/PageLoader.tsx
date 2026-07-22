import { LoaderCircleIcon } from "lucide-react";
import { Page } from "~/components/Page";

export function PageLoader() {
  return (
    <Page center>
      <LoaderCircleIcon
        className="size-8 animate-spin text-slate-400"
        aria-label="Loading"
      />
    </Page>
  );
}
