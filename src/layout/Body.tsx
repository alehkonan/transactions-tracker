import type { PropsWithChildren } from "react";

export const Body = ({ children }: PropsWithChildren) => {
  return <body className="bg-background min-h-dvh">{children}</body>;
};
