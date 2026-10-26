import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { currencyCodeEnum } from "~/database/enums";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import { isMoneyInput, negateMoney, sumMoney } from "~/utils/money";
import { findReallocation } from "./reallocation";
import { deleteReallocation, saveReallocation } from "./reallocation-mutations";
import { sphereBalances, sphereHasHistory } from "./sphere-lifecycle";
import { createSphere, deleteSphere, updateSphere } from "./sphere-mutations";
import type { operatingBalances } from "./operating";
import type { ReallocationPayload, SyncedSphere } from "~/modules/sync/sync-types";

const fieldClass =
  "border-border bg-surface text-text focus-visible:ring-accent h-11 min-w-0 rounded-2xl border px-3 focus-visible:ring-2 focus-visible:outline-none sm:h-9";

function SphereItem({
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
  const context = useReplicaBinding();
  const nameId = useId();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const balances = sphereBalances(sphere.profileId, sphere.id, allocations);
  const used = sphereHasHistory(sphere, allocations);
  const nonzero = balances.some((row) => row.balance !== "0.00");
  useEffect(() => {
    if (manageOpen)
      (confirmDelete ? backRef.current : nameRef.current)?.focus({ preventScroll: true });
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
    <li className="border-border border-t py-3" data-testid={`sphere-${sphere.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-40">
          <h4 className="text-text font-semibold wrap-anywhere">{sphere.name}</h4>
          {sphere.archived && <span className="text-text-muted text-xs">Archived</span>}
          {balances.length === 0 && (
            <p className="text-text-muted text-sm">No money assigned yet.</p>
          )}
        </div>
        <dl className="flex flex-wrap gap-x-5 gap-y-2" data-testid="sphere-balances">
          {balances.map((row) => (
            <div key={row.currencyCode}>
              <dt className="text-text-muted text-xs">{row.currencyCode}</dt>
              <dd
                className={`font-mono tabular-nums ${Number(row.balance) < 0 ? "text-warning" : "text-text"}`}
              >
                {formatMoney(row.balance, row.currencyCode)}
                {Number(row.balance) < 0 && (
                  <span className="block font-sans text-xs">Below zero</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {!sphere.archived && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={pending || !context || !complete}
              onClick={(event) => onAssign(event.currentTarget)}
            >
              Assign money<span className="sr-only"> to {sphere.name}</span>
            </Button>
            {nonzero && (
              <Button
                variant="secondary"
                disabled={pending || !context || !complete}
                onClick={(event) => onMove(event.currentTarget)}
              >
                Move money<span className="sr-only"> from {sphere.name}</span>
              </Button>
            )}
          </div>
        )}
      </div>
      <Button
        variant="secondary"
        className="mt-2"
        data-testid="sphere-manage"
        aria-haspopup="dialog"
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setError(null);
          setConfirmDelete(false);
          setManageOpen(true);
        }}
      >
        Manage<span className="sr-only"> {sphere.name}</span>
      </Button>
      <Dialog
        title={confirmDelete ? `Delete ${sphere.name}?` : `Manage ${sphere.name}`}
        open={manageOpen}
        onOpenChange={setManageOpen}
        requireAction={pending}
        closeButtonLabel={pending ? undefined : "Close sphere settings"}
      >
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
                  defaultValue={sphere.name}
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
                disabled={pending || !context || (!sphere.archived && (!complete || nonzero))}
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
                  disabled={pending || !complete || !context}
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
            <Button
              variant="secondary"
              className="mt-4"
              disabled={pending}
              onClick={() => setManageOpen(false)}
            >
              Cancel
            </Button>
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
    </li>
  );
}

export function NamedSpheres({
  complete,
  operating,
}: {
  complete: boolean;
  operating: ReturnType<typeof operatingBalances>;
}) {
  const { spheres, allocations, selectedProfileId } = useSyncStore();
  const context = useReplicaBinding();
  const nameId = useId();
  const typeId = useId();
  const previewId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const historyRef = useRef<HTMLElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [createType, setCreateType] = useState<"FUNDS" | "CAPITAL">("FUNDS");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [fromSphereId, setFromSphereId] = useState("");
  const [toSphereId, setToSphereId] = useState("");
  const [currencyCode, setCurrencyCode] = useState<ReallocationPayload["currencyCode"]>("USD");
  const [amount, setAmount] = useState("");
  const [reallocationError, setReallocationError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const owned = spheres.filter(
    (row) => row.profileId === selectedProfileId && row.deletedAt == null,
  );
  const active = owned.filter((sphere) => !sphere.archived);
  const named = active.filter((sphere) => sphere.type !== "OPERATING");
  const archived = owned
    .filter((sphere) => sphere.archived)
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const operatingId = active.find((sphere) => sphere.type === "OPERATING")?.id ?? "";
  const reallocations = [
    ...new Set(
      allocations
        .filter((row) => row.profileId === selectedProfileId && row.deletedAt == null)
        .flatMap((row) => row.reallocationId ?? []),
    ),
  ]
    .flatMap((id) => {
      const pair = findReallocation(allocations, id);
      return pair && pair.every((row) => row.deletedAt == null) ? [pair] : [];
    })
    .toSorted((a, b) => b[0].createdAt.getTime() - a[0].createdAt.getTime());
  const currentPair = editingId ? findReallocation(allocations, editingId) : undefined;
  const deletingPair = reallocations.find(([from]) => from.reallocationId === deletingId);
  function balanceBefore(sphereId: string) {
    const balance =
      sphereBalances(selectedProfileId ?? "", sphereId, allocations).find(
        (row) => row.currencyCode === currencyCode,
      )?.balance ?? "0.00";
    return sumMoney([
      balance,
      ...(currentPair ?? [])
        .filter(
          (row) =>
            row.deletedAt == null && row.sphereId === sphereId && row.currencyCode === currencyCode,
        )
        .map((row) => negateMoney(row.amount)),
    ]);
  }
  const available = balanceBefore(fromSphereId);
  const destinationBefore = balanceBefore(toSphereId);
  const validAmount = isMoneyInput(amount) && Number(amount) > 0;
  const remaining = validAmount ? sumMoney([available, negateMoney(amount)]) : available;
  const destinationAfter = validAmount ? sumMoney([destinationBefore, amount]) : destinationBefore;
  const belowZero = validAmount && fromSphereId !== "" && Number(remaining) < 0;
  const sourceCurrencies = sphereBalances(selectedProfileId ?? "", fromSphereId, allocations).map(
    (row) => row.currencyCode,
  );
  const sourceName = owned.find((row) => row.id === fromSphereId)?.name ?? "Source";
  const destinationName = owned.find((row) => row.id === toSphereId)?.name ?? "Destination";

  function resetReallocation() {
    setEditorOpen(false);
    setEditingId(undefined);
    setFromSphereId("");
    setToSphereId("");
    setAmount("");
    setDeletingId(null);
    setReallocationError(null);
  }
  useEffect(() => {
    resetReallocation();
    setCreating(false);
    setNotice("");
    setError(null);
  }, [selectedProfileId]);
  useEffect(() => {
    if (editorOpen) amountRef.current?.focus({ preventScroll: true });
  }, [editorOpen]);

  function preferredCurrency(sourceId: string): ReallocationPayload["currencyCode"] {
    const balances = sphereBalances(selectedProfileId ?? "", sourceId, allocations);
    const preferred =
      balances.find((row) => row.currencyCode === currencyCode && Number(row.balance) > 0) ??
      balances.find((row) => Number(row.balance) > 0) ??
      balances[0];
    return (
      currencyCodeEnum.enumValues.find((code) => code === preferred?.currencyCode) ?? currencyCode
    );
  }
  function openAllocation(from: string, to: string, trigger?: HTMLElement) {
    if (trigger && !creating) trigger.focus({ preventScroll: true });
    setEditingId(undefined);
    setFromSphereId(from);
    setToSphereId(to);
    setCurrencyCode(preferredCurrency(from));
    setAmount("");
    setReallocationError(null);
    setDeletingId(null);
    setEditorOpen(true);
  }
  function closeEditor() {
    resetReallocation();
    setCreating(false);
    setError(null);
  }
  function openCreator(trigger: HTMLButtonElement) {
    trigger.focus({ preventScroll: true });
    setError(null);
    setCreating(true);
  }
  function handleRemovedSphere(message: string) {
    setNotice(message);
    createButtonRef.current?.focus({ preventScroll: true });
  }
  function runReallocation(action: () => Promise<void>, message: string) {
    setReallocationError(null);
    startTransition(async () => {
      try {
        await action();
        setNotice(message);
        closeEditor();
        if (deletingId)
          requestAnimationFrame(() =>
            (historyRef.current ?? createButtonRef.current)?.focus({ preventScroll: true }),
          );
      } catch (cause) {
        setReallocationError(
          cause instanceof Error ? cause.message : "Could not save the allocation. Try again.",
        );
      }
    });
  }
  return (
    <section
      aria-labelledby="named-spheres-heading"
      data-testid="named-spheres"
      className="space-y-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <h2 id="named-spheres-heading" className="text-text text-lg font-semibold">
            What your money is for
          </h2>
          <p className="text-text-muted mt-1 text-sm">
            The same money, grouped by purpose across all accounts. Account balances stay unchanged.
          </p>
        </div>
        <Button
          ref={createButtonRef}
          variant="secondary"
          onClick={(event) => openCreator(event.currentTarget)}
          aria-haspopup="dialog"
        >
          Create sphere
        </Button>
      </div>
      <output className="text-text block text-sm empty:hidden">{notice}</output>
      {!complete && (
        <p className="text-warning text-sm">
          Balances are still loading. Finish synchronization before assigning money or archiving
          spheres.
        </p>
      )}

      <section
        aria-labelledby="operating-heading"
        className="border-border bg-surface-muted rounded-xl border p-4"
        data-testid="operating-sphere"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="operating-heading" className="text-text font-semibold">
              Operating
            </h3>
            <p className="text-text-muted mt-1 text-sm">Everyday money</p>
          </div>
          {named.length > 0 && (
            <Button
              variant="secondary"
              disabled={pending || !context || !complete}
              onClick={(event) => openAllocation(operatingId, "", event.currentTarget)}
            >
              Assign money
            </Button>
          )}
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3" data-testid="operating-balances">
          {operating.map((balance) => (
            <div key={balance.currencyCode}>
              <dt className="text-text-muted text-xs">{balance.currencyCode}</dt>
              <dd
                className={`font-mono tabular-nums ${Number(balance.sphereBalance) < 0 ? "text-warning" : "text-text"}`}
              >
                {formatMoney(balance.sphereBalance, balance.currencyCode)}
              </dd>
              {Number(balance.sphereBalance) < 0 && (
                <p className="text-warning mt-1 max-w-52 text-xs">
                  {Number(balance.accountBalance) < 0
                    ? "Your accounts total is also below zero in this currency."
                    : "More assigned to purposes than held in this currency."}
                </p>
              )}
            </div>
          ))}
        </dl>
        {operating.length === 0 && (
          <p className="text-text-muted mt-3 text-sm">
            Create an account in Accounts to start tracking and assigning money.
          </p>
        )}
        {operating.some((row) => row.status === "diverged") && (
          <p role="alert" className="text-warning mt-3 text-sm">
            Purpose totals differ from account balances. Check synchronization in Settings.
          </p>
        )}
      </section>

      {named.length === 0 && (
        <div className="max-w-prose">
          <h3 className="text-text font-semibold">Give your money a purpose</h3>
          <p className="text-text-muted mt-1 text-sm">
            Create a sphere for a trip, an emergency reserve or investments. Then assign money from
            Operating, now or later.
          </p>
        </div>
      )}
      <Dialog
        title={creating ? "Create a sphere" : editingId ? "Edit allocation" : "Assign money"}
        open={creating || editorOpen}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        requireAction={pending}
        closeButtonLabel={pending ? undefined : "Close action"}
      >
        {editorOpen && (
          <form
            aria-label={editingId ? "Edit allocation" : "Assign money"}
            className="mt-3 space-y-4"
            data-testid="reallocation-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (context && selectedProfileId)
                runReallocation(
                  () =>
                    saveReallocation(
                      selectedProfileId,
                      { fromSphereId, toSphereId, currencyCode, amount },
                      context,
                      editingId,
                    ),
                  `${editingId ? "Updated" : "Assigned"} ${formatMoney(amount, currencyCode)} from ${sourceName} to ${destinationName}. Account balances are unchanged.`,
                );
            }}
          >
            <div>
              <p className="text-text-muted mt-1 max-w-prose text-sm">
                Change the purpose of your money. Account balances and income and expense history
                stay the same.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                From sphere
                <select
                  required
                  value={fromSphereId}
                  onChange={(event) => {
                    const from = event.target.value;
                    setFromSphereId(from);
                    if (toSphereId === from) setToSphereId("");
                    setCurrencyCode(preferredCurrency(from));
                  }}
                  className={fieldClass}
                  data-testid="reallocation-from"
                >
                  <option value="">Choose source</option>
                  {active.map((sphere) => (
                    <option key={sphere.id} value={sphere.id}>
                      {sphere.type === "OPERATING"
                        ? "Operating"
                        : `${sphere.type === "FUNDS" ? "Funds" : "Capital"} / ${sphere.name}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                To sphere
                <select
                  required
                  value={toSphereId}
                  onChange={(event) => setToSphereId(event.target.value)}
                  className={fieldClass}
                  data-testid="reallocation-to"
                >
                  <option value="">Choose destination</option>
                  {active.map((sphere) => (
                    <option key={sphere.id} value={sphere.id} disabled={sphere.id === fromSphereId}>
                      {sphere.type === "OPERATING"
                        ? "Operating"
                        : `${sphere.type === "FUNDS" ? "Funds" : "Capital"} / ${sphere.name}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                Amount
                <input
                  ref={amountRef}
                  required
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className={fieldClass}
                  placeholder="0.00"
                  data-testid="reallocation-amount"
                  aria-invalid={amount !== "" && !validAmount}
                  aria-describedby={`${previewId} ${previewId}-amount-help`}
                />
                <span
                  id={`${previewId}-amount-help`}
                  className={
                    amount !== "" && !validAmount
                      ? "text-danger text-xs"
                      : "text-text-muted text-xs"
                  }
                >
                  Use a positive amount with up to two decimal places.
                </span>
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-sm">
                Currency
                <select
                  value={currencyCode}
                  onChange={(event) =>
                    setCurrencyCode(event.target.value as ReallocationPayload["currencyCode"])
                  }
                  className={fieldClass}
                  data-testid="reallocation-currency"
                >
                  {sourceCurrencies.length > 0 && (
                    <optgroup label="Source currencies">
                      {currencyCodeEnum.enumValues
                        .filter((code) => sourceCurrencies.includes(code))
                        .map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                    </optgroup>
                  )}
                  <optgroup
                    label={
                      sourceCurrencies.length
                        ? "Other currencies (no source balance)"
                        : "Currencies"
                    }
                  >
                    {currencyCodeEnum.enumValues
                      .filter((code) => !sourceCurrencies.includes(code))
                      .map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
            </div>
            <div id={previewId} aria-live="polite" className="border-border border-y py-3 text-sm">
              <p className="text-text-muted mb-2">
                {editingId
                  ? "Before this allocation → after saving"
                  : "Current balance → after saving"}
              </p>
              <dl className="space-y-2">
                {fromSphereId && (
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                    <dt className="text-text min-w-0 wrap-anywhere">{sourceName}</dt>
                    <dd
                      className={`font-mono tabular-nums ${belowZero ? "text-warning" : "text-text"}`}
                    >
                      {formatMoney(available, currencyCode)} →{" "}
                      {formatMoney(remaining, currencyCode)}
                    </dd>
                  </div>
                )}
                {toSphereId && (
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                    <dt className="text-text min-w-0 wrap-anywhere">{destinationName}</dt>
                    <dd className="text-text font-mono tabular-nums">
                      {formatMoney(destinationBefore, currencyCode)} →{" "}
                      {formatMoney(destinationAfter, currencyCode)}
                    </dd>
                  </div>
                )}
              </dl>
              {!fromSphereId && (
                <p className="text-text-muted">Choose a source to see its available balance.</p>
              )}
            </div>
            {belowZero && (
              <output
                className="border-warning-border bg-warning-muted text-warning block max-w-prose rounded-lg border p-3 text-sm"
                data-testid="reallocation-warning"
              >
                {sourceName} will be {formatMoney(remaining, currencyCode)}. You are assigning more
                than its available balance. You can allocate anyway and cover the shortfall later.
              </output>
            )}
            {reallocationError && (
              <p role="alert" className="text-danger text-sm" data-testid="reallocation-error">
                {reallocationError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={
                  pending ||
                  !context ||
                  !complete ||
                  active.length < 2 ||
                  !validAmount ||
                  !fromSphereId ||
                  !toSphereId ||
                  fromSphereId === toSphereId
                }
                data-testid="reallocation-save"
              >
                {pending
                  ? "Saving…"
                  : belowZero
                    ? "Allocate anyway"
                    : editingId
                      ? "Save allocation"
                      : "Assign money"}
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={closeEditor}
                data-testid="reallocation-cancel"
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {creating && (
          <form
            className="mt-3 space-y-3"
            data-testid="sphere-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!context || !selectedProfileId) return;
              const form = event.currentTarget;
              const name = String(new FormData(form).get("name") ?? "");
              setError(null);
              startTransition(async () => {
                try {
                  const id = await createSphere(selectedProfileId, name, createType, context);
                  form.reset();
                  setCreating(false);
                  setNotice(`Created ${name.trim()}. Assign money now, or cancel to do it later.`);
                  openAllocation(operatingId, id);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not create the sphere. Try again.",
                  );
                }
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <label htmlFor={typeId} className="flex min-w-0 flex-col gap-1 text-sm">
                Type
                <select
                  id={typeId}
                  name="type"
                  value={createType}
                  onChange={(event) =>
                    setCreateType(event.target.value === "CAPITAL" ? "CAPITAL" : "FUNDS")
                  }
                  className={fieldClass}
                  data-testid="sphere-create-type"
                  aria-describedby={`${typeId}-help`}
                >
                  <option value="FUNDS">Funds</option>
                  <option value="CAPITAL">Capital</option>
                </select>
              </label>
              <label htmlFor={nameId} className="flex min-w-0 flex-col gap-1 text-sm">
                Name
                <input
                  id={nameId}
                  name="name"
                  required
                  placeholder={
                    createType === "FUNDS" ? "e.g. Emergency reserve" : "e.g. Investments"
                  }
                  autoCapitalize="words"
                  className={fieldClass}
                  data-testid="sphere-create-name"
                />
              </label>
            </div>
            <p id={`${typeId}-help`} className="text-text-muted max-w-prose text-sm">
              {createType === "FUNDS"
                ? "Funds are goals and reserves you plan to spend."
                : "Capital is savings and investments tracked as money. Record investment income as Income."}{" "}
              The type cannot be changed later.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                type="submit"
                disabled={pending || !context || !selectedProfileId}
                data-testid="sphere-create"
              >
                {pending ? "Creating…" : "Create and assign money"}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={closeEditor}>
                Cancel
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-danger text-sm">
                {error}
              </p>
            )}
          </form>
        )}
      </Dialog>

      {(["FUNDS", "CAPITAL"] as const).map((type) => {
        const rows = named
          .filter((sphere) => sphere.type === type)
          .toSorted((a, b) => a.name.localeCompare(b.name));
        if (rows.length === 0) return null;
        return (
          <section
            key={type}
            aria-labelledby={`spheres-${type}-heading`}
            data-testid={`spheres-${type.toLowerCase()}`}
          >
            <h3 id={`spheres-${type}-heading`} className="text-text font-semibold">
              {type === "FUNDS" ? "Funds" : "Capital"}
            </h3>
            <p className="text-text-muted mt-1 mb-3 text-sm">
              {type === "FUNDS"
                ? "Goals and reserves for future spending."
                : "Savings and investments tracked as money."}
            </p>
            <ul>
              {rows.map((sphere) => (
                <SphereItem
                  key={sphere.id}
                  sphere={sphere}
                  complete={complete}
                  onAssign={(trigger) => openAllocation(operatingId, sphere.id, trigger)}
                  onMove={(trigger) => openAllocation(sphere.id, "", trigger)}
                  onRemoved={handleRemovedSphere}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {archived.length > 0 && (
        <details className="border-border border-t pt-2" data-testid="archived-spheres">
          <summary className="text-text-muted focus-visible:ring-accent w-fit cursor-pointer rounded-lg py-3 text-sm focus-visible:ring-2 focus-visible:outline-none">
            Archived ({archived.length})
          </summary>
          <ul>
            {archived.map((sphere) => (
              <SphereItem
                key={sphere.id}
                sphere={sphere}
                complete={complete}
                onAssign={(trigger) => openAllocation(operatingId, sphere.id, trigger)}
                onMove={(trigger) => openAllocation(sphere.id, "", trigger)}
                onRemoved={handleRemovedSphere}
              />
            ))}
          </ul>
        </details>
      )}
      {reallocations.length > 0 && (
        <details className="border-border border-t pt-2" data-testid="reallocations">
          <summary
            ref={historyRef}
            className="text-text focus-visible:ring-accent w-fit cursor-pointer rounded-lg py-3 font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            Allocation history ({reallocations.length})
          </summary>
          <p className="text-text-muted mb-3 max-w-prose text-sm">
            Changes of purpose only. These do not change account balances.
          </p>
          <ul>
            {reallocations.map(([from, to]) => {
              const fromSphere = owned.find((sphere) => sphere.id === from.sphereId);
              const toSphere = owned.find((sphere) => sphere.id === to.sphereId);
              const editable =
                complete && fromSphere && toSphere && !fromSphere.archived && !toSphere.archived;
              return (
                <li
                  key={from.reallocationId}
                  className="border-border flex flex-wrap items-center justify-between gap-3 border-t py-3"
                  data-testid={`reallocation-${from.reallocationId}`}
                >
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-text wrap-anywhere">
                      {fromSphere?.name ?? "Loading sphere…"} →{" "}
                      {toSphere?.name ?? "Loading sphere…"}
                    </p>
                    <p className="text-text-muted mt-1 text-xs">
                      {from.createdAt.toLocaleString()}
                    </p>
                    {!editable && complete && (
                      <p className="text-text-muted mt-1 text-sm">
                        Restore archived spheres before editing or deleting this allocation.
                      </p>
                    )}
                  </div>
                  <p className="text-text font-mono tabular-nums" data-testid="reallocation-value">
                    {formatMoney(to.amount, to.currencyCode)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={pending || !context || !editable}
                      data-testid="reallocation-edit"
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        setEditingId(from.reallocationId!);
                        setFromSphereId(from.sphereId);
                        setToSphereId(to.sphereId);
                        setCurrencyCode(to.currencyCode);
                        setAmount(to.amount);
                        setDeletingId(null);
                        setReallocationError(null);
                        setEditorOpen(true);
                      }}
                    >
                      Edit
                      <span className="sr-only">
                        {" "}
                        allocation from {fromSphere?.name} to {toSphere?.name}
                      </span>
                    </Button>
                    <Button
                      variant="danger"
                      disabled={pending || !context || !editable}
                      data-testid="reallocation-delete"
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        setReallocationError(null);
                        setDeletingId(from.reallocationId!);
                      }}
                    >
                      Delete
                      <span className="sr-only">
                        {" "}
                        allocation from {fromSphere?.name} to {toSphere?.name}
                      </span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      <Dialog
        title="Delete allocation?"
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingId(null);
            setReallocationError(null);
          }
        }}
        requireAction={pending}
        closeButtonLabel={pending ? undefined : "Close deletion confirmation"}
      >
        {deletingPair && (
          <div className="mt-3 space-y-4" data-testid="reallocation-delete-confirmation">
            <p className="text-text text-sm">
              {formatMoney(deletingPair[1].amount, deletingPair[1].currencyCode)} returns from{" "}
              {owned.find((sphere) => sphere.id === deletingPair[1].sphereId)?.name} to{" "}
              {owned.find((sphere) => sphere.id === deletingPair[0].sphereId)?.name}. Account
              balances stay unchanged.
            </p>
            {reallocationError && (
              <p role="alert" className="text-danger text-sm">
                {reallocationError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={pending || !context || !complete}
                data-testid="reallocation-delete-confirm"
                onClick={() =>
                  context &&
                  runReallocation(
                    () => deleteReallocation(deletingPair[0].reallocationId!, context),
                    "Allocation deleted. Its effect on both spheres has been reversed.",
                  )
                }
              >
                Delete allocation
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setDeletingId(null);
                  setReallocationError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <details className="border-border border-t pt-2">
        <summary className="text-text-muted focus-visible:ring-accent w-fit cursor-pointer rounded-lg py-3 text-sm focus-visible:ring-2 focus-visible:outline-none">
          How purpose balances work
        </summary>
        <p className="text-text-muted max-w-prose text-sm">
          In each currency, Operating + Funds + Capital equals your account total, including
          archived accounts. These are the same money viewed by purpose, not extra balances to add
          to your accounts.
        </p>
        <output
          className="text-text-muted mt-2 block text-xs"
          data-testid="operating-reconciliation"
        >
          {!complete
            ? "Balances are incomplete — synchronize to finish loading."
            : operating.some((row) => row.status === "diverged")
              ? "Balances differ — check synchronization in Settings."
              : "Purpose totals match account totals in every currency."}
        </output>
      </details>
    </section>
  );
}
