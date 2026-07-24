import { twJoin } from "tailwind-merge";

type Props = {
  children: string;
  variant: "page" | "card";
};

export function Title({ children, variant }: Props) {
  return (
    <p
      className={twJoin(
        "text-text",
        variant === "page" && "text-3xl font-bold",
        variant === "card" && "text-xl font-semibold",
      )}
    >
      {children}
    </p>
  );
}
