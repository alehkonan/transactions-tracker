import { createContext, useMemo, useRef, type JSX, type ReactNode } from "react";
import { twJoin } from "tailwind-merge";
import { Title } from "./Title";

type DialogContextProps = {
  onOpen: () => void;
  onClose: () => void;
};

type Props = {
  children: ReactNode;
  renderTrigger: (props: DialogContextProps) => JSX.Element;
  title: string;
  /** User has to click any action button to close the dialog */
  requireAction?: boolean;
};

export const DialogContext = createContext<DialogContextProps>({
  onOpen: () => undefined,
  onClose: () => undefined,
});

export function Dialog({ children, renderTrigger, title, requireAction }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  const contextProps = useMemo<DialogContextProps>(
    () => ({
      onOpen: () => ref.current?.showModal(),
      onClose: () => ref.current?.close(),
    }),
    [],
  );

  return (
    <DialogContext value={contextProps}>
      {renderTrigger(contextProps)}
      <dialog
        ref={ref}
        closedby={requireAction ? "none" : "any"}
        className={twJoin(
          "border-border m-auto max-h-[85dvh] w-full overflow-y-auto rounded-xl border p-4 sm:w-2xl",
        )}
      >
        <Title variant="card">{title}</Title>
        {children}
      </dialog>
    </DialogContext>
  );
}
