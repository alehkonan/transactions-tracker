import { use } from "react";
import { Button } from "./Button";
import { PopoverContext } from "./Popover";

type PopoverConfirmProps = {
  message: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  onConfirm: () => void;
};

/** Confirm/cancel body for a `Popover`; closes the popover before running `onConfirm`. */
export function PopoverConfirm({
  message,
  confirmLabel = "Confirm",
  confirmVariant = "primary",
  onConfirm,
}: PopoverConfirmProps) {
  const { onClose } = use(PopoverContext);

  return (
    <div className="flex flex-col gap-2 text-sm">
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
