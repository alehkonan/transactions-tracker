import { TriangleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { FormTaskContext } from "~/modules/forms/form-task";
import { SheetNavigationGuard } from "~/modules/forms/SheetNavigationGuard";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import { toUsd } from "~/utils/money";
import { sphereBalances, sphereHasHistory } from "./sphere-lifecycle";
import { deleteSphere, updateSphere } from "./sphere-mutations";
import type { SyncedSphere } from "~/modules/sync/sync-types";

const fieldClass =
  "border-border bg-surface text-text focus-visible:ring-accent h-11 min-w-0 rounded-lg border px-3 focus-visible:ring-2 focus-visible:outline-none";
const sphereActionClass = "px-2 text-sm sm:px-3";
const sphereBalancesClass = "space-y-2";
const currencyBalanceClass = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1";

export function SphereDetail({
  sphere,
  complete,
  onAssign,
  onMove,
  onRemoved,
}: {
  sphere: SyncedSphere;
  complete: boolean;
  onAssign: (trigger: HTMLButtonElement) => void;
  onMove: (trigger: HTMLButtonElement) => void;
  onRemoved: (message: string) => void;
}) {
  const allocations = useSyncStore((state) => state.allocations);
  const usdRates = useSyncStore((state) => state.usdRates);
  const context = useReplicaBinding();
  const nameId = useId();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [draftName, setDraftName] = useState(sphere.name);
  const nameRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const balances = sphereBalances(sphere.profileId, sphere.id, allocations);
  const balanceUsd = balances.reduce(
    (total, row) => total + toUsd(row.balance, row.currencyCode, usdRates),
    0,
  );
  const used = sphereHasHistory(sphere, allocations);
  const nonzero = balances.some((row) => row.balance !== "0.00");
  const belowZero = balances.some((row) => Number(row.balance) < 0);
  useEffect(() => {
    if (!manageOpen) return;
    const frame = requestAnimationFrame(() =>
      (confirmDelete ? backRef.current : nameRef.current)?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [manageOpen, confirmDelete]);
  function run(action: () => Promise<void>, removalNotice?: string) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        setConfirmDelete(false);
        setManageOpen(false);
        if (removalNotice) requestAnimationFrame(() => onRemoved(removalNotice));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save the sphere. Try again.");
      }
    });
  }
  return (
    <section
      className="bg-surface rounded-lg p-4"
      aria-label="Sphere balances"
      data-testid="sphere-detail"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-semibold">Balance by currency</h2>
        <span
          className={`inline-flex items-center justify-end gap-1 text-right font-mono text-sm whitespace-nowrap tabular-nums ${belowZero ? "text-warning" : "text-text"}`}
          data-testid="sphere-total"
          title={belowZero ? "At least one currency balance is below zero." : undefined}
        >
          {belowZero && <TriangleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />}
          <span className="sr-only">Approximate balance in USD: </span>
          {complete ? `≈ ${formatMoney(balanceUsd.toFixed(2), "USD")}` : "Loading…"}
          {belowZero && (
            <span className="sr-only">. At least one currency balance is below zero.</span>
          )}
        </span>
      </div>
      <div className="space-y-4">
        {sphere.archived && <p className="text-text-muted text-xs">Archived</p>}
        {balances.length === 0 && (
          <p className="text-text-muted text-sm">
            {complete ? "No money assigned yet." : "Balances are still loading."}
          </p>
        )}
        {balances.length > 0 && (
          <dl className={sphereBalancesClass} data-testid="sphere-balances">
            {balances.map((row) => (
              <div key={row.currencyCode} className={currencyBalanceClass}>
                <dt className="text-text-muted text-xs">{row.currencyCode}</dt>
                <dd
                  className={`text-right font-mono tabular-nums ${Number(row.balance) < 0 ? "text-warning" : "text-text"}`}
                >
                  {formatMoney(row.balance, row.currencyCode)}
                  {Number(row.balance) < 0 && (
                    <span className="block font-sans text-xs">Below zero</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {!sphere.archived && (
            <div className={nonzero ? "grid grid-cols-2 gap-2 sm:flex" : "flex"}>
              <Button
                variant="secondary"
                className={sphereActionClass}
                disabled={pending || !context || !complete}
                onClick={(event) => onAssign(event.currentTarget)}
              >
                Assign money<span className="sr-only"> to {sphere.name}</span>
              </Button>
              {nonzero && (
                <Button
                  variant="secondary"
                  className={sphereActionClass}
                  disabled={pending || !context || !complete}
                  onClick={(event) => onMove(event.currentTarget)}
                >
                  Move money<span className="sr-only"> from {sphere.name}</span>
                </Button>
              )}
            </div>
          )}
          <Button
            variant="secondary"
            className={`${sphereActionClass} self-start sm:ml-auto`}
            data-testid="sphere-manage"
            aria-haspopup="dialog"
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              setError(null);
              setConfirmDelete(false);
              setDraftName(sphere.name);
              setManageOpen(true);
            }}
          >
            Manage<span className="sr-only"> {sphere.name}</span>
          </Button>
        </div>
      </div>
      <Dialog
        title={confirmDelete ? `Delete ${sphere.name}?` : `Manage ${sphere.name}`}
        open={manageOpen}
        isDirty={!confirmDelete && draftName !== sphere.name}
        onOpenChange={setManageOpen}
        requireAction={pending}
        closeButtonLabel={pending ? undefined : "Close sphere settings"}
      >
        <SheetNavigationGuard
          isDirty={!confirmDelete && draftName !== sphere.name}
          isPending={pending}
        />
        {!confirmDelete ? (
          <>
            <form
              className="mt-2 flex flex-wrap items-end gap-2"
              data-testid="sphere-rename-form"
              onSubmit={(event) => {
                event.preventDefault();
                const name = String(new FormData(event.currentTarget).get("name") ?? "");
                if (context)
                  run(() => updateSphere(sphere, { name, archived: sphere.archived }, context));
              }}
            >
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm" htmlFor={nameId}>
                Name
                <input
                  ref={nameRef}
                  key={sphere.name}
                  id={nameId}
                  name="name"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  required
                  className={fieldClass}
                  data-testid="sphere-name"
                />
              </label>
              <Button
                variant="secondary"
                type="submit"
                disabled={pending || !context}
                data-testid="sphere-save"
              >
                Save name
              </Button>
            </form>
            <p className="text-text-muted mt-2 text-xs">
              Type is fixed. History stays with this sphere when renamed or archived.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={
                  pending ||
                  !context ||
                  draftName !== sphere.name ||
                  (!sphere.archived && (!complete || nonzero))
                }
                data-testid="sphere-archive"
                onClick={() =>
                  context &&
                  run(
                    () =>
                      updateSphere(
                        sphere,
                        { name: sphere.name, archived: !sphere.archived },
                        context,
                      ),
                    sphere.archived ? `Restored ${sphere.name}.` : `Archived ${sphere.name}.`,
                  )
                }
              >
                {sphere.archived ? "Restore" : "Archive"}
              </Button>
              {!used && (
                <Button
                  variant="danger"
                  disabled={pending || !complete || !context || draftName !== sphere.name}
                  data-testid="sphere-delete"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              )}
            </div>
            {nonzero && !sphere.archived && (
              <p className="text-text-muted mt-2 text-sm">
                Every currency balance must be zero to archive.
              </p>
            )}
            {used && (
              <p className="text-text-muted mt-2 text-sm">
                This sphere has history and cannot be deleted.
              </p>
            )}
            <FormTaskContext.Consumer>
              {({ onCancel }) => (
                <Button variant="secondary" className="mt-4" disabled={pending} onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </FormTaskContext.Consumer>
          </>
        ) : (
          <div className="mt-3 space-y-4" data-testid="sphere-delete-confirmation">
            <p className="text-text text-sm">
              This empty sphere will be removed. Your accounts and transactions stay unchanged.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={pending || !context}
                data-testid="sphere-delete-confirm"
                onClick={() =>
                  context &&
                  run(
                    () => deleteSphere(sphere, context),
                    `Deleted ${sphere.name}. Account balances are unchanged.`,
                  )
                }
              >
                Delete sphere
              </Button>
              <Button
                ref={backRef}
                variant="secondary"
                disabled={pending}
                onClick={() => setConfirmDelete(false)}
              >
                Back
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-danger mt-2 text-sm">
            {error}
          </p>
        )}
      </Dialog>
    </section>
  );
}
