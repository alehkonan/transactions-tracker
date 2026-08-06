import { twJoin } from "tailwind-merge";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function Card({ children }: Props) {
  return (
    <article className={twJoin("bg-surface border-border rounded-xl border p-2")}>
      {children}
    </article>
  );
}
