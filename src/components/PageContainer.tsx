import { twJoin } from "tailwind-merge";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function PageContainer({ children, className }: Props) {
  return <div className={twJoin("mx-auto w-full max-w-7xl p-4", className)}>{children}</div>;
}
