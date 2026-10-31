import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { currencyCodeEnum } from "~/database/enums";
import { FormTaskContext } from "~/modules/forms/form-task";
import { SheetNavigationGuard } from "~/modules/forms/SheetNavigationGuard";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import { isMoneyInput, negateMoney, sumMoney, toUsd } from "~/utils/money";
import { findReallocation } from "./reallocation";
import { deleteReallocation, saveReallocation } from "./reallocation-mutations";
import { sphereBalances } from "./sphere-lifecycle";
import { createSphere } from "./sphere-mutations";
import { SphereActivity } from "./SphereActivity";
import { SphereDetail } from "./SphereDetail";
import { SphereLink } from "./SphereLink";
import type { operatingBalances } from "./operating";
import type { ReallocationPayload, SyncedSphere } from "~/modules/sync/sync-types";

const fieldClass =
  "border-border bg-surface text-text focus-visible:ring-accent h-11 min-w-0 rounded-lg border px-3 focus-visible:ring-2 focus-visible:outline-none";
const supportingSummaryClass =
  "text-text-muted hover:bg-surface-hover hover:text-text active:bg-surface-active focus-visible:ring-accent focus-visible:ring-offset-background flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none [&::-webkit-details-marker]:hidden";
const sphereActionClass = "px-2 text-sm sm:px-3";
const sphereBalancesClass = "max-w-sm space-y-2";
const currencyBalanceClass = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1";

export function NamedSpheres({
  complete,
  operating,
  selectedSphere,
  archivedView = false,
}: {
  complete: boolean;
  operating: ReturnType<typeof operatingBalances>;
  selectedSphere?: SyncedSphere;
  archivedView?: boolean;
}) {
  const { spheres, allocations, selectedProfileId, usdRates } = useSyncStore();
  const navigate = useNavigate();
  const context = useReplicaBinding();
  const nameId = useId();
  const typeId = useId();
  const previewId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const historyRef = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [allocationBaseline, setAllocationBaseline] = useState("");
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
  const operatingSphere = active.find((sphere) => sphere.type === "OPERATING");
  const operatingUsd = operating.reduce(
    (total, row) => total + toUsd(row.sphereBalance, row.currencyCode, usdRates),
    0,
  );
  const operatingDiverged = operating.some((row) => row.status === "diverged");
  const reallocations = [
    ...new Set(
      allocations
        .filter((row) => row.profileId === selectedProfileId && row.deletedAt == null)
        .flatMap((row) => row.reallocationId ?? []),
    ),
  ]
    .flatMap((id) => {
      const pair = findReallocation(allocations, id);
      return pair &&
        pair.every((row) => row.deletedAt == null) &&
        (!selectedSphere || pair.some((row) => row.sphereId === selectedSphere.id))
        ? [pair]
        : [];
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
    if (!editorOpen) return;
    const frame = requestAnimationFrame(() => amountRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
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
    const currency = preferredCurrency(from);
    setCurrencyCode(currency);
    setAllocationBaseline(JSON.stringify([from, to, currency, ""]));
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
    setCreateName("");
    setCreateType("FUNDS");
    setCreating(true);
  }
  function handleRemovedSphere(message: string) {
    setNotice(message);
    if (
      selectedSphere &&
      !useSyncStore
        .getState()
        .spheres.some((row) => row.id === selectedSphere.id && row.deletedAt == null)
    ) {
      void navigate({ to: "/accounts", search: { view: "purposes" } });
    }
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
      aria-label={
        selectedSphere ? "Sphere details" : archivedView ? "Archived purposes" : "Purposes"
      }
      data-testid="named-spheres"
      className="flex max-w-4xl flex-col gap-6"
    >
      {!selectedSphere && !archivedView && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-prose">
            <h2 id="named-spheres-heading" className="text-text text-lg font-semibold">
              What your money is for
            </h2>
            <p className="text-text-muted mt-1 text-sm">
              The same money, grouped by purpose across all accounts. Account balances stay
              unchanged.
            </p>
          </div>
          <Button
            ref={createButtonRef}
            data-testid="sphere-create-open"
            variant="secondary"
            onClick={(event) => openCreator(event.currentTarget)}
            aria-haspopup="dialog"
          >
            Create sphere
          </Button>
        </div>
      )}
      <output className="text-text block text-sm empty:hidden">{notice}</output>
      {!complete && (
        <p className="text-warning text-sm">
          Balances are still loading. Finish synchronization before assigning money or archiving
          spheres.
        </p>
      )}

      {!selectedSphere && !archivedView && operatingSphere && (
        <ul className="bg-surface overflow-hidden rounded-lg" data-testid="operating-sphere">
          <SphereLink sphere={operatingSphere} complete={complete} diverged={operatingDiverged} />
        </ul>
      )}
      {!selectedSphere && !archivedView && !operatingSphere && (
        <p className="bg-surface text-text-muted rounded-lg p-4 text-sm">
          {complete
            ? "Operating is unavailable. Check synchronization in Settings."
            : "Loading Operating…"}
        </p>
      )}
      {selectedSphere?.type === "OPERATING" && (
        <section
          className="bg-surface rounded-lg"
          aria-label="Operating balances"
          data-testid="operating-sphere"
        >
          <div className="space-y-4 p-4">
            <h2 className="font-semibold">Balance by currency</h2>
            <p className="text-text-muted text-sm">Everyday money · Permanent system sphere</p>
            <p className="font-mono text-lg" data-testid="operating-total">
              {complete ? `≈ ${formatMoney(operatingUsd.toFixed(2), "USD")}` : "Loading…"}
            </p>
            {operating.length > 0 && (
              <dl className={sphereBalancesClass} data-testid="operating-balances">
                {operating.map((balance) => (
                  <div key={balance.currencyCode} className={currencyBalanceClass}>
                    <dt className="text-text-muted text-xs">{balance.currencyCode}</dt>
                    <dd
                      className={`text-right font-mono tabular-nums ${Number(balance.sphereBalance) < 0 ? "text-warning" : "text-text"}`}
                    >
                      {formatMoney(balance.sphereBalance, balance.currencyCode)}
                    </dd>
                    {Number(balance.sphereBalance) < 0 && (
                      <dd className="text-warning col-span-2 max-w-prose text-xs">
                        {Number(balance.accountBalance) < 0
                          ? "Your accounts total is also below zero in this currency."
                          : "More assigned to purposes than held in this currency."}
                      </dd>
                    )}
                  </div>
                ))}
              </dl>
            )}
            {operating.length === 0 && (
              <p className="text-text-muted text-sm">
                {complete
                  ? "Create an account in Accounts to start tracking and assigning money."
                  : "Balances are still loading."}
              </p>
            )}
            {operatingDiverged && (
              <dl className="space-y-2" data-testid="purpose-reconciliation-differences">
                {operating
                  .filter((row) => row.status === "diverged")
                  .map((row) => {
                    const purposeTotal = sumMoney(
                      allocations
                        .filter(
                          (allocation) =>
                            allocation.profileId === selectedProfileId &&
                            allocation.deletedAt == null &&
                            allocation.currencyCode === row.currencyCode,
                        )
                        .map((allocation) => allocation.amount),
                    );
                    return (
                      <div key={row.currencyCode} className="text-warning text-sm">
                        <dt>{row.currencyCode} reconciliation</dt>
                        <dd>
                          Accounts {formatMoney(row.accountBalance, row.currencyCode)} · Purposes{" "}
                          {formatMoney(purposeTotal, row.currencyCode)} · Difference{" "}
                          {formatMoney(
                            sumMoney([row.accountBalance, negateMoney(purposeTotal)]),
                            row.currencyCode,
                          )}
                        </dd>
                      </div>
                    );
                  })}
              </dl>
            )}
            {operatingDiverged && (
              <p role="alert" className="text-warning text-sm">
                Purpose totals differ from account balances. Check synchronization in Settings.
              </p>
            )}
            {named.length > 0 && (
              <Button
                variant="secondary"
                className={sphereActionClass}
                disabled={pending || !context || !complete}
                onClick={(event) => openAllocation(operatingId, "", event.currentTarget)}
              >
                Assign money
              </Button>
            )}
          </div>
        </section>
      )}
      {selectedSphere && selectedSphere.type !== "OPERATING" && (
        <SphereDetail
          sphere={selectedSphere}
          complete={complete}
          onAssign={(trigger) => openAllocation(operatingId, selectedSphere.id, trigger)}
          onMove={(trigger) => openAllocation(selectedSphere.id, "", trigger)}
          onRemoved={handleRemovedSphere}
        />
      )}
      {!selectedSphere && !archivedView && named.length === 0 && complete && (
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
        isDirty={
          creating
            ? createName !== "" || createType !== "FUNDS"
            : editorOpen &&
              JSON.stringify([fromSphereId, toSphereId, currencyCode, amount]) !==
                allocationBaseline
        }
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        requireAction={pending}
        closeButtonLabel={pending ? undefined : "Close action"}
      >
        <SheetNavigationGuard
          isDirty={
            creating
              ? createName !== "" || createType !== "FUNDS"
              : editorOpen &&
                JSON.stringify([fromSphereId, toSphereId, currencyCode, amount]) !==
                  allocationBaseline
          }
          isPending={pending}
        />
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
              <FormTaskContext.Consumer>
                {({ onCancel }) => (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={onCancel}
                    data-testid="reallocation-cancel"
                  >
                    Cancel
                  </Button>
                )}
              </FormTaskContext.Consumer>
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
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
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
              <FormTaskContext.Consumer>
                {({ onCancel }) => (
                  <Button variant="secondary" disabled={pending} onClick={onCancel}>
                    Cancel
                  </Button>
                )}
              </FormTaskContext.Consumer>
            </div>
            {error && (
              <p role="alert" className="text-danger text-sm">
                {error}
              </p>
            )}
          </form>
        )}
      </Dialog>

      {!selectedSphere &&
        !archivedView &&
        (["FUNDS", "CAPITAL"] as const).map((type) => {
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
              <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg">
                {rows.map((sphere) => (
                  <SphereLink key={sphere.id} sphere={sphere} complete={complete} />
                ))}
              </ul>
            </section>
          );
        })}
      <div className="flex flex-col gap-1">
        {!selectedSphere && !archivedView && (
          <Link
            to="/accounts/purposes/archived"
            className="bg-surface text-text hover:bg-surface-hover focus-visible:ring-accent flex min-h-11 items-center justify-between rounded-lg px-4 py-3 focus-visible:ring-2"
            data-testid="archived-spheres"
          >
            Archived purposes ({archived.length}){" "}
            <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0" />
          </Link>
        )}
        {archivedView &&
          (archived.length ? (
            <div className="space-y-6">
              {(["FUNDS", "CAPITAL"] as const).map((type) => {
                const rows = archived.filter((sphere) => sphere.type === type);
                return (
                  rows.length > 0 && (
                    <section key={type} aria-label={type === "FUNDS" ? "Funds" : "Capital"}>
                      <h2 className="mb-2 font-semibold">
                        {type === "FUNDS" ? "Funds" : "Capital"}
                      </h2>
                      <ul className="bg-surface divide-border divide-y overflow-hidden rounded-lg">
                        {rows.map((sphere) => (
                          <SphereLink key={sphere.id} sphere={sphere} complete={complete} />
                        ))}
                      </ul>
                    </section>
                  )
                );
              })}
            </div>
          ) : (
            <p className="bg-surface text-text-muted rounded-lg p-4">
              {complete ? "No archived purposes." : "Loading archived purposes…"}
            </p>
          ))}
        {selectedSphere && <SphereActivity sphere={selectedSphere} complete={complete} />}
        {selectedSphere && (
          <section
            className="mt-6"
            data-testid="reallocations"
            aria-labelledby="allocation-history-heading"
          >
            <h2
              id="allocation-history-heading"
              ref={historyRef}
              tabIndex={-1}
              className="mb-2 font-semibold"
            >
              Allocation history ({reallocations.length})
            </h2>
            <p className="text-text-muted mb-3 max-w-prose text-sm">
              Changes of purpose only. These do not change account balances.
            </p>
            {reallocations.length === 0 && (
              <p className="bg-surface text-text-muted rounded-lg p-4 text-sm">
                {complete ? "No reallocations for this sphere yet." : "Loading allocation history…"}
              </p>
            )}
            <ul className="bg-surface divide-border divide-y rounded-lg px-4">
              {reallocations.map(([from, to]) => {
                const fromSphere = owned.find((sphere) => sphere.id === from.sphereId);
                const toSphere = owned.find((sphere) => sphere.id === to.sphereId);
                const editable =
                  complete && fromSphere && toSphere && !fromSphere.archived && !toSphere.archived;
                return (
                  <li
                    key={from.reallocationId}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
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
                    <p
                      className="text-text font-mono tabular-nums"
                      data-testid="reallocation-value"
                    >
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
                          setAllocationBaseline(
                            JSON.stringify([
                              from.sphereId,
                              to.sphereId,
                              to.currencyCode,
                              to.amount,
                            ]),
                          );
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
          </section>
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
          <SheetNavigationGuard isDirty={false} isPending={pending} />
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
        <details className="group/disclosure">
          <summary className={supportingSummaryClass} data-testid="purpose-balances-help">
            <span>How purpose balances work</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 group-open/disclosure:rotate-180"
            />
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
              : operatingDiverged
                ? "Balances differ — check synchronization in Settings."
                : "Purpose totals match account totals in every currency."}
          </output>
        </details>
      </div>
    </section>
  );
}
