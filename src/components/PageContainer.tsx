import { twJoin } from "tailwind-merge";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function PageContainer({ children, className }: Props) {
  return <div className={twJoin("max-w-page mx-auto w-full p-4", className)}>{children}</div>;
}
