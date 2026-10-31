import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

type Props = {
  title: string;
  backLabel: string;
} & (
  | { backTo: "/settings" | "/transactions"; onBack?: never }
  | { onBack: () => void; backTo?: never }
);

export function PageHeader({ title, backTo, backLabel, onBack }: Props) {
  const backClassName =
    "text-accent focus-visible:ring-accent -ml-2 inline-flex min-h-11 max-w-full items-center gap-1 rounded-lg px-2 text-left focus-visible:ring-2 focus-visible:outline-none";
  const label = (
    <>
      <ChevronLeftIcon aria-hidden="true" className="size-5 shrink-0" />
      <span className="min-w-0 break-words">{backLabel}</span>
    </>
  );
  return (
    <header className="mb-5">
      {onBack ? (
        <button type="button" onClick={onBack} data-testid="parent-back" className={backClassName}>
          {label}
        </button>
      ) : (
        <Link to={backTo} data-testid="parent-back" className={backClassName}>
          {label}
        </Link>
      )}
      <h1 className="text-2xl font-bold tracking-tight break-words">{title}</h1>
    </header>
  );
}
