import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { createContext, useMemo, useState, type JSX, type ReactNode } from "react";
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
  const [open, setOpen] = useState(false);

  const contextProps = useMemo<DialogContextProps>(
    () => ({
      onOpen: () => setOpen(true),
      onClose: () => setOpen(false),
    }),
    [],
  );

  return (
    <DialogContext value={contextProps}>
      <BaseDialog.Root
        open={open}
        // Escape/outside-press requests are ignored so the dialog can only be
        // closed via an explicit action button (context.onClose).
        onOpenChange={requireAction ? undefined : setOpen}
        disablePointerDismissal={requireAction}
      >
        <BaseDialog.Trigger render={renderTrigger(contextProps)} />
        <BaseDialog.Portal>
          <BaseDialog.Backdrop
            className={twJoin(
              "fixed inset-0 bg-black/50 transition-opacity duration-150",
              "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            )}
          />
          <BaseDialog.Viewport className="fixed inset-0 flex items-center justify-center p-4">
            <BaseDialog.Popup
              className={twJoin(
                "border-border bg-surface max-h-[85dvh] w-full overflow-y-auto rounded-xl border p-4 sm:w-2xl",
                "transition-[opacity,transform] duration-150",
                "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
                "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              )}
            >
              <Title variant="card">{title}</Title>
              {children}
            </BaseDialog.Popup>
          </BaseDialog.Viewport>
        </BaseDialog.Portal>
      </BaseDialog.Root>
    </DialogContext>
  );
}
