import { use } from "react";
import { Button } from "./Button";
import { PopoverContext } from "./Popover";

type PopoverConfirmProps = {
  title?: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  onConfirm: () => void;
};

/** Confirm/cancel body for a `Popover`; closes the popover before running `onConfirm`. */
export function PopoverConfirm({
  title,
  message,
  confirmLabel = "Confirm",
  confirmVariant = "primary",
  onConfirm,
}: PopoverConfirmProps) {
  const { onClose } = use(PopoverContext);

  return (
    <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 text-sm">
      {title && <p className="text-text font-bold">{title}</p>}
      <p>{message}</p>
      <div className="flex justify-end gap-2">
        <Button className="min-w-16 py-1 text-xs" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="min-w-16 py-1 text-xs"
          variant={confirmVariant}
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
