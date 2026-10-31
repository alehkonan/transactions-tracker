import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";

type Props = {
  title: string;
  backTo: "/settings";
  backLabel: string;
};

export function PageHeader({ title, backTo, backLabel }: Props) {
  return (
    <header className="mb-5">
      <Link
        to={backTo}
        data-testid="parent-back"
        className="text-accent focus-visible:ring-accent -ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronLeftIcon aria-hidden="true" className="size-5" />
        {backLabel}
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
    </header>
  );
}
