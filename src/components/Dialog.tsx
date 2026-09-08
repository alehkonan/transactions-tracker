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
  title: string;
  /** User has to click any action button to close the dialog */
  requireAction?: boolean;
} & (
  | {
      /** Renders and owns its own trigger; open state is internal. */
      renderTrigger: (props: DialogContextProps) => JSX.Element;
      open?: undefined;
      onOpenChange?: undefined;
    }
  | {
      /** No trigger of its own — open state is driven by the caller (e.g. a menu item). */
      renderTrigger?: undefined;
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }
);

export const DialogContext = createContext<DialogContextProps>({
  onOpen: () => undefined,
  onClose: () => undefined,
});

export function Dialog({
  children,
  renderTrigger,
  title,
  requireAction,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const contextProps = useMemo<DialogContextProps>(
    () => ({
      onOpen: () => setOpen(true),
      onClose: () => setOpen(false),
    }),
    [setOpen],
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
        {renderTrigger && <BaseDialog.Trigger render={renderTrigger(contextProps)} />}
        <BaseDialog.Portal>
          <BaseDialog.Backdrop
            className={twJoin(
              "z-dialog-backdrop bg-overlay fixed inset-0 transition-opacity duration-150",
              "data-ending-style:opacity-0 data-starting-style:opacity-0",
            )}
          />
          <BaseDialog.Viewport className="z-dialog fixed inset-0 flex items-end justify-center sm:items-center sm:p-4">
            <BaseDialog.Popup
              className={twJoin(
                "border-border bg-surface max-h-[85dvh] w-full overflow-y-auto rounded-t-xl border p-4 sm:w-2xl sm:rounded-xl",
                "transition-[opacity,transform] duration-150",
                "data-ending-style:translate-y-full data-ending-style:opacity-0",
                "data-starting-style:translate-y-full data-starting-style:opacity-0",
                "sm:data-ending-style:translate-y-0 sm:data-ending-style:scale-95",
                "sm:data-starting-style:translate-y-0 sm:data-starting-style:scale-95",
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
