import { twJoin } from "tailwind-merge";

type Props = {
  children: string;
  variant: "page" | "card" | "section";
};

export function Title({ children, variant }: Props) {
  return (
    <p
      className={twJoin(
        "text-text",
        variant === "page" && "text-3xl font-bold",
        variant === "card" && "text-xl font-semibold",
        variant === "section" && "text-sm font-bold",
      )}
    >
      {children}
    </p>
  );
}
