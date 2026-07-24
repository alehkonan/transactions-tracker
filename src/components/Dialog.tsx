import { type ReactNode, type Ref } from "react";
import { twJoin } from "tailwind-merge";

type Props = {
  children: ReactNode;
  ref: Ref<HTMLDialogElement>;
};

export function Dialog({ children, ref }: Props) {
  return (
    <dialog
      ref={ref}
      closedby="none"
      className={twJoin("border-border m-auto w-full rounded-xl border p-4 sm:w-2xl")}
    >
      {children}
    </dialog>
  );
}
