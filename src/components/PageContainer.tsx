import { twJoin } from "tailwind-merge";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function PageContainer({ children }: Props) {
  return <div className={twJoin("p-4 max-w-7xl mx-auto")}>{children}</div>;
}
