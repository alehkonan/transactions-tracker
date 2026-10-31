import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { twJoin } from "tailwind-merge";
import { FormTaskContext, type FormTaskState } from "~/modules/forms/form-task";
import { Button } from "./Button";
import { Title } from "./Title";

type DialogTriggerProps = {
  onOpen: () => void;
  onClose: () => void;
};

type Props = {
  children: ReactNode;
  title: string;
  /** Prevent cancellation while an action is in progress or an explicit decision is required. */
  requireAction?: boolean;
  /** Renders an opt-in visible close button with this accessible label. */
  closeButtonLabel?: string;
  /** For native forms owned by the caller, rather than a child using useFormTask. */
  isDirty?: boolean;
  renderTrigger?: (props: DialogTriggerProps) => JSX.Element;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function Dialog({
  children,
  renderTrigger,
  title,
  requireAction,
  closeButtonLabel,
  open: controlledOpen,
  onOpenChange,
  isDirty = false,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const forms = useRef(new Map<string, FormTaskState>());
  const viewportRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const resize = () => {
      viewportRef.current?.style.setProperty("--sheet-height", `${viewport.height}px`);
      viewportRef.current?.style.setProperty("--sheet-top", `${viewport.offsetTop}px`);
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, [open]);
  const complete = useCallback(() => {
    setConfirmDiscard(false);
    setOpen(false);
  }, [setOpen]);
  const cancel = useCallback(() => {
    if (requireAction || [...forms.current.values()].some((form) => form.isPending)) return;
    if (isDirty || [...forms.current.values()].some((form) => form.isDirty)) {
      setConfirmDiscard(true);
    } else complete();
  }, [requireAction, isDirty, complete]);
  const register = useCallback((id: string, state: FormTaskState) => {
    forms.current.set(id, state);
    return () => {
      forms.current.delete(id);
    };
  }, []);
  const task = useMemo(
    () => ({ onCancel: cancel, onComplete: complete, register }),
    [cancel, complete, register],
  );

  const contextProps = useMemo<DialogTriggerProps>(
    () => ({
      onOpen: () => setOpen(true),
      onClose: cancel,
    }),
    [setOpen, cancel],
  );

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) setOpen(true);
        else {
          details.cancel();
          cancel();
        }
      }}
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
        <BaseDialog.Viewport
          ref={viewportRef}
          style={{
            height: "var(--sheet-height, 100dvh)",
            top: "var(--sheet-top, 0px)",
            bottom: "auto",
          }}
          className="z-dialog fixed inset-0 flex items-end justify-center pt-[max(1rem,env(safe-area-inset-top))] sm:px-4"
        >
          <BaseDialog.Popup
            aria-labelledby={titleId}
            className={twJoin(
              "border-border bg-surface text-text relative max-h-[min(85dvh,100%)] w-full overflow-y-auto overscroll-contain rounded-t-xl border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-w-2xl",
              "transition-[opacity,transform] duration-150",
              "data-ending-style:translate-y-full data-ending-style:opacity-0",
              "data-starting-style:translate-y-full data-starting-style:opacity-0",
              "motion-reduce:transition-none",
            )}
          >
            <div id={titleId}>
              <Title variant="card" className={closeButtonLabel ? "pr-12" : undefined}>
                {title}
              </Title>
            </div>
            {closeButtonLabel && (
              <BaseDialog.Close
                type="button"
                aria-label={closeButtonLabel}
                className={twJoin(
                  "border-border bg-surface text-text-muted hover:bg-surface-muted hover:text-text",
                  "focus-visible:ring-accent absolute top-2 right-2 grid size-11 place-items-center rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                )}
              >
                <XIcon className="size-4" />
              </BaseDialog.Close>
            )}
            <FormTaskContext value={task}>{children}</FormTaskContext>
            <Dialog
              title="Discard changes?"
              open={confirmDiscard && open}
              onOpenChange={setConfirmDiscard}
              requireAction
            >
              <p className="mt-3 text-sm">Your unsaved changes will be lost.</p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  data-testid="discard-keep-editing"
                  onClick={() => setConfirmDiscard(false)}
                >
                  Keep editing
                </Button>
                <Button variant="danger" data-testid="discard-confirm" onClick={complete}>
                  Discard changes
                </Button>
              </div>
            </Dialog>
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
