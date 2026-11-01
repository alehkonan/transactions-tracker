import { Popover as BasePopover } from "@base-ui/react/popover";
import { createContext, useMemo, useState, type JSX, type ReactNode } from "react";
import { twJoin } from "tailwind-merge";
import { Dialog } from "./Dialog";

type PopoverContextProps = {
  onOpen: () => void;
  onClose: () => void;
};

type Props = {
  children: ReactNode;
  "aria-label"?: string;
  sheet?: boolean;
  renderTrigger: (props: PopoverContextProps) => JSX.Element;
};

export const PopoverContext = createContext<PopoverContextProps>({
  onOpen: () => undefined,
  onClose: () => undefined,
});

export function Popover({ children, renderTrigger, "aria-label": ariaLabel, sheet }: Props) {
  const [open, setOpen] = useState(false);

  const contextProps = useMemo<PopoverContextProps>(
    () => ({
      onOpen: () => setOpen(true),
      onClose: () => setOpen(false),
    }),
    [],
  );

  return (
    <PopoverContext value={contextProps}>
      {sheet ? (
        <Dialog
          title={ariaLabel ?? "Confirm action"}
          renderTrigger={renderTrigger}
          open={open}
          onOpenChange={setOpen}
        >
          {children}
        </Dialog>
      ) : (
        <BasePopover.Root open={open} onOpenChange={setOpen}>
          <BasePopover.Trigger render={renderTrigger(contextProps)} />
          <BasePopover.Portal>
            <BasePopover.Positioner sideOffset={4} className="z-dropdown">
              <BasePopover.Popup
                aria-label={ariaLabel}
                className={twJoin(
                  "border-border bg-surface text-text m-0 rounded-xl border p-3 shadow-lg",
                  "transition-[opacity,transform] duration-150 ease-out",
                  "data-starting-style:scale-95 data-starting-style:opacity-0",
                  "data-ending-style:scale-95 data-ending-style:opacity-0",
                )}
              >
                {children}
              </BasePopover.Popup>
            </BasePopover.Positioner>
          </BasePopover.Portal>
        </BasePopover.Root>
      )}
    </PopoverContext>
  );
}
