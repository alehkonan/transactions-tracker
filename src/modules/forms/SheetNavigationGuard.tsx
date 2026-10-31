import { useLayoutEffect } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { useRoutedFormTask } from "./useRoutedFormTask";

const stayInSheet = () => {};

/** Sheet dismissal stays with Dialog; route and browser exits share the routed form lifecycle. */
export function SheetNavigationGuard({
  isDirty,
  isPending,
}: {
  isDirty: boolean;
  isPending: boolean;
}) {
  const { task, blocker } = useRoutedFormTask({ onCancel: stayInSheet, onComplete: stayInSheet });
  const { register } = task;
  useLayoutEffect(() => register("sheet", { isDirty, isPending }), [register, isDirty, isPending]);
  return (
    <Dialog
      title={isPending ? "Saving changes…" : "Discard changes?"}
      open={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
      requireAction
    >
      <p className="mt-3 text-sm">
        {isPending
          ? "Wait for this local operation to finish before leaving."
          : "Your unsaved changes will be lost."}
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          data-testid="navigation-keep-editing"
          onClick={() => blocker.reset?.()}
        >
          Keep editing
        </Button>
        <Button
          variant="danger"
          data-testid="navigation-discard"
          disabled={isPending}
          onClick={() => blocker.proceed?.()}
        >
          Discard changes
        </Button>
      </div>
    </Dialog>
  );
}
