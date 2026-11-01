import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="text-text-muted mb-2 px-4 text-sm font-medium">
        {title}
      </h2>
      <div className="bg-surface divide-border divide-y overflow-hidden rounded-lg">{children}</div>
    </section>
  );
}

type SettingsLinkProps = {
  to: "/profile" | "/settings/categories" | "/settings/security";
  label: string;
  description?: string;
  "data-testid"?: string;
};

export function SettingsLink({ to, label, description, ...props }: SettingsLinkProps) {
  return (
    <Link
      to={to}
      className="hover:bg-surface-hover focus-visible:ring-accent flex min-h-11 items-center gap-3 p-4 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
      {...props}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium wrap-anywhere">{label}</span>
        {description && (
          <span className="text-text-muted mt-0.5 block text-sm wrap-anywhere">{description}</span>
        )}
      </span>
      <ChevronRightIcon className="text-text-muted size-5 shrink-0" aria-hidden="true" />
    </Link>
  );
}
