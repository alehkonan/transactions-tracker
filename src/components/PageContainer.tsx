import { twJoin } from "tailwind-merge";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function PageContainer({ children }: Props) {
  return <div className={twJoin("mx-auto max-w-7xl p-4")}>{children}</div>;
}
