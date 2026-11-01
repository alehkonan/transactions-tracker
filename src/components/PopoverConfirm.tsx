import { use, useState } from "react";
import { useFormTask } from "~/modules/forms/form-task";
import { Button } from "./Button";
import { PopoverContext } from "./Popover";

type PopoverConfirmProps = {
  title?: string;
  message: string;
  confirmLabel?: string;
  confirmTestId?: string;
  confirmVariant?: "primary" | "danger";
  onConfirm: () => void | Promise<void>;
};

/** Confirmation body: complete only after the action succeeds, retaining errors for retry. */
export function PopoverConfirm({
  title,
  message,
  confirmLabel = "Confirm",
  confirmTestId,
  confirmVariant = "primary",
  onConfirm,
}: PopoverConfirmProps) {
  const { onClose } = use(PopoverContext);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { onCancel, onComplete } = useFormTask({ isDirty: false, isPending });

  return (
    <div className="mt-3 flex max-w-prose flex-col gap-3 text-sm">
      {title && <p className="sr-only">{title}</p>}
      <p>{message}</p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={isPending}
          onClick={() => {
            onCancel();
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button
          data-testid={confirmTestId}
          variant={confirmVariant}
          disabled={isPending}
          onClick={async () => {
            if (isPending) return;
            setIsPending(true);
            setError(null);
            try {
              await onConfirm();
              onComplete();
              onClose();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not complete this action. Try again.",
              );
            } finally {
              setIsPending(false);
            }
          }}
        >
          {isPending ? "Working…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
