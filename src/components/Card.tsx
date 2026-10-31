import { twJoin } from "tailwind-merge";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function Card({ children }: Props) {
  return <article className={twJoin("bg-surface rounded-lg p-3")}>{children}</article>;
}
