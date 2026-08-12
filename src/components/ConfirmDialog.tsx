import { Button } from "./Button";
import { Dialog } from "./Dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  onConfirm: () => void;
};

/** Controlled confirm/cancel dialog, for confirming an action triggered from somewhere without its own anchor (e.g. a `Menu` item). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "Confirm",
  confirmVariant = "primary",
  onConfirm,
}: Props) {
  return (
    <Dialog title={title} open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-3 pt-3 text-sm">
        <p>{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
