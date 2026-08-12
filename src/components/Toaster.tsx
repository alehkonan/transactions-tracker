import { Toast } from "@base-ui/react/toast";
import { XIcon } from "lucide-react";
import { twJoin } from "tailwind-merge";

/**
 * Renders every active toast (from `Toast.useToastManager().add(...)`), styled like `Card`.
 * Mount once inside a `Toast.Provider`, e.g. in the root layout.
 */
export function Toaster() {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport className="z-toast fixed bottom-4 left-4 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className={twJoin(
              "bg-surface border-border rounded-xl border p-2 shadow-sm",
              "transition-[opacity,transform] duration-150",
              "data-ending-style:opacity-0 data-starting-style:-translate-x-full data-starting-style:opacity-0",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <Toast.Title className="text-text text-sm font-semibold" />
                <Toast.Description className="text-text-muted text-sm" />
              </div>
              <Toast.Close
                aria-label="Dismiss"
                className="text-text-muted hover:text-text shrink-0"
              >
                <XIcon className="size-4" />
              </Toast.Close>
            </div>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
