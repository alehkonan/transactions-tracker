import { twJoin } from "tailwind-merge";

type Props = {
  children: string;
  variant?: "card";
};

export function Title({ children, variant = "card" }: Props) {
  return (
    <p className={twJoin(variant === "card" && "text-xl font-semibold text-text")}>{children}</p>
  );
}
