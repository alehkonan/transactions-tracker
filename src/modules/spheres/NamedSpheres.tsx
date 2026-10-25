import { useEffect, useId, useState, useTransition } from "react";
import { Button } from "~/components/Button";
import { currencyCodeEnum } from "~/database/enums";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import { isMoneyInput, negateMoney, sumMoney } from "~/utils/money";
import { findReallocation } from "./reallocation";
import { deleteReallocation, saveReallocation } from "./reallocation-mutations";
import { sphereBalances, sphereHasHistory } from "./sphere-lifecycle";
import { createSphere, deleteSphere, updateSphere } from "./sphere-mutations";
import type { ReallocationPayload, SyncedSphere } from "~/modules/sync/sync-types";

const fieldClass =
  "border-border bg-surface text-text focus-visible:ring-accent h-11 min-w-0 rounded-2xl border px-3 focus-visible:ring-2 focus-visible:outline-none sm:h-9";

function SphereItem({ sphere, complete }: { sphere: SyncedSphere; complete: boolean }) {
  const allocations = useSyncStore((state) => state.allocations);
  const context = useReplicaBinding();
  const nameId = useId();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const balances = sphereBalances(sphere.profileId, sphere.id, allocations);
  const used = sphereHasHistory(sphere, allocations);
  const nonzero = balances.some((row) => row.balance !== "0.00");
  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        setConfirmDelete(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save the sphere. Try again.");
      }
    });
  }
  return (
    <li className="border-border border-t py-4" data-testid={`sphere-${sphere.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-text font-semibold wrap-anywhere">{sphere.name}</h4>
        {sphere.archived && <span className="text-text-muted text-sm">Archived</span>}
      </div>
      <dl className="my-2 flex flex-wrap gap-x-8 gap-y-2" data-testid="sphere-balances">
        {balances.map((row) => (
          <div key={row.currencyCode}>
            <dt className="text-text-muted text-xs">{row.currencyCode}</dt>
            <dd className="text-text font-mono tabular-nums">
              {formatMoney(row.balance, row.currencyCode)}
            </dd>
          </div>
        ))}
      </dl>
      {balances.length === 0 && (
        <p className="text-text-muted my-2 text-sm">No money assigned yet.</p>
      )}
      {balances.some((row) => Number(row.balance) < 0) && (
        <p className="text-warning my-2 text-sm">This sphere has a negative balance.</p>
      )}
      <details>
        <summary
          className="text-accent w-fit cursor-pointer py-2 text-sm"
          data-testid="sphere-manage"
        >
          Manage sphere
        </summary>
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
              run(() =>
                updateSphere(sphere, { name: sphere.name, archived: !sphere.archived }, context),
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
        {confirmDelete && (
          <div
            className="mt-3 flex flex-wrap items-center gap-2"
            data-testid="sphere-delete-confirmation"
          >
            <p className="text-text text-sm">Delete “{sphere.name}”?</p>
            <Button
              variant="danger"
              disabled={pending || !context}
              data-testid="sphere-delete-confirm"
              onClick={() => context && run(() => deleteSphere(sphere, context))}
            >
              Delete sphere
            </Button>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        )}
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
      </details>
      {error && (
        <p role="alert" className="text-danger mt-2 text-sm">
          {error}
        </p>
      )}
    </li>
  );
}

export function NamedSpheres({ complete }: { complete: boolean }) {
  const { spheres, allocations, selectedProfileId } = useSyncStore();
  const context = useReplicaBinding();
  const nameId = useId();
  const typeId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [fromSphereId, setFromSphereId] = useState("");
  const [toSphereId, setToSphereId] = useState("");
  const [currencyCode, setCurrencyCode] = useState<ReallocationPayload["currencyCode"]>("USD");
  const [amount, setAmount] = useState("");
  const [reallocationError, setReallocationError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  function resetReallocation() {
    setEditingId(undefined);
    setFromSphereId("");
    setToSphereId("");
    setAmount("");
    setDeletingId(null);
    setReallocationError(null);
  }
  useEffect(() => {
    resetReallocation();
  }, [selectedProfileId]);
  const owned = spheres.filter(
    (row) => row.profileId === selectedProfileId && row.deletedAt == null,
  );
  const active = owned.filter((sphere) => !sphere.archived);
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
  const fromBalance =
    fromSphereId && selectedProfileId
      ? (sphereBalances(selectedProfileId, fromSphereId, allocations).find(
          (row) => row.currencyCode === currencyCode,
        )?.balance ?? "0.00")
      : "0.00";
  const previousEffect = (currentPair ?? [])
    .filter(
      (row) =>
        row.deletedAt == null && row.sphereId === fromSphereId && row.currencyCode === currencyCode,
    )
    .map((row) => negateMoney(row.amount));
  const available = sumMoney([fromBalance, ...previousEffect]);
  const remaining = isMoneyInput(amount) ? sumMoney([available, negateMoney(amount)]) : available;
  function runReallocation(action: () => Promise<void>) {
    setReallocationError(null);
    startTransition(async () => {
      try {
        await action();
        resetReallocation();
      } catch (cause) {
        setReallocationError(
          cause instanceof Error ? cause.message : "Could not save the reallocation. Try again.",
        );
      }
    });
  }
  return (
    <section aria-labelledby="named-spheres-heading" data-testid="named-spheres">
      <h2 id="named-spheres-heading" className="text-text text-lg font-semibold">
        Funds and Capital
      </h2>
      <p className="text-text-muted mt-1 text-sm">
        Name the purposes your money serves, across all accounts.
      </p>
      {!complete && (
        <p className="text-warning mt-2 text-sm">
          Balances are incomplete. Finish loading before archiving or deleting.
        </p>
      )}
      {(["FUNDS", "CAPITAL"] as const).map((type) => {
        const rows = owned
          .filter((row) => row.type === type)
          .toSorted(
            (a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name),
          );
        return (
          <div key={type} className="mt-5" data-testid={`spheres-${type.toLowerCase()}`}>
            <h3 className="text-text font-semibold">{type === "FUNDS" ? "Funds" : "Capital"}</h3>
            <p className="text-text-muted mb-3 text-sm">
              {type === "FUNDS"
                ? "Goals and reserves, such as travel or an emergency fund."
                : "Savings and investments tracked as money. Record investment income as Income."}
            </p>
            {rows.length === 0 ? (
              <p className="text-text-muted text-sm">
                {type === "FUNDS" ? "No Funds spheres yet." : "No Capital spheres yet."}
              </p>
            ) : (
              <ul>
                {rows.map((sphere) => (
                  <SphereItem key={sphere.id} sphere={sphere} complete={complete} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <form
        className="border-border mt-5 flex flex-wrap items-end gap-3 border-t pt-4"
        data-testid="sphere-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!context || !selectedProfileId) return;
          const form = event.currentTarget;
          const data = new FormData(form);
          const name = String(data.get("name") ?? "");
          const type = data.get("type") === "CAPITAL" ? "CAPITAL" : "FUNDS";
          setError(null);
          startTransition(async () => {
            try {
              await createSphere(selectedProfileId, name, type, context);
              form.reset();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "Could not create the sphere. Try again.",
              );
            }
          });
        }}
      >
        <label htmlFor={typeId} className="flex flex-col gap-1 text-sm">
          Type
          <select id={typeId} name="type" className={fieldClass} data-testid="sphere-create-type">
            <option value="FUNDS">Funds</option>
            <option value="CAPITAL">Capital</option>
          </select>
        </label>
        <label htmlFor={nameId} className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-sm">
          Name
          <input
            id={nameId}
            name="name"
            required
            placeholder="e.g. Thailand"
            autoCapitalize="words"
            className={fieldClass}
            data-testid="sphere-create-name"
          />
        </label>
        <Button
          variant="primary"
          type="submit"
          disabled={pending || !context || !selectedProfileId}
          data-testid="sphere-create"
        >
          {pending ? "Creating…" : "Create sphere"}
        </Button>
        {error && (
          <p role="alert" className="text-danger w-full text-sm">
            {error}
          </p>
        )}
      </form>
      <section
        className="border-border mt-8 border-t pt-5"
        aria-labelledby="reallocations-heading"
        data-testid="reallocations"
      >
        <h3 id="reallocations-heading" className="text-text text-lg font-semibold">
          Reallocate money
        </h3>
        <p className="text-text-muted mt-1 text-sm">
          Reserve money for a purpose or move a reserve. Account balances and income and expense
          history stay the same.
        </p>
        {!complete && (
          <p className="text-warning mt-2 text-sm">
            Finish loading sphere balances before creating, editing, or deleting a reallocation.
          </p>
        )}
        {active.length < 2 && (
          <p className="text-text-muted mt-2 text-sm">
            Create a Funds or Capital sphere to reserve money from Operating.
          </p>
        )}
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          data-testid="reallocation-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (context && selectedProfileId)
              runReallocation(() =>
                saveReallocation(
                  selectedProfileId,
                  { fromSphereId, toSphereId, currencyCode, amount },
                  context,
                  editingId,
                ),
              );
          }}
        >
          <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 text-sm">
            From sphere
            <select
              required
              value={fromSphereId}
              onChange={(event) => setFromSphereId(event.target.value)}
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
          <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 text-sm">
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
          <label className="flex flex-col gap-1 text-sm">
            Currency
            <select
              value={currencyCode}
              onChange={(event) =>
                setCurrencyCode(event.target.value as ReallocationPayload["currencyCode"])
              }
              className={fieldClass}
              data-testid="reallocation-currency"
            >
              {currencyCodeEnum.enumValues.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 basis-32 flex-col gap-1 text-sm">
            Amount
            <input
              required
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={fieldClass}
              placeholder="0.00"
              data-testid="reallocation-amount"
              aria-describedby="reallocation-balance-preview"
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !context || !complete || active.length < 2}
            data-testid="reallocation-save"
          >
            {pending ? "Saving…" : editingId ? "Save reallocation" : "Reallocate"}
          </Button>
          {editingId && (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={resetReallocation}
              data-testid="reallocation-cancel"
            >
              Cancel edit
            </Button>
          )}
          <div className="w-full text-sm" id="reallocation-balance-preview" aria-live="polite">
            {fromSphereId && (
              <p className="text-text-muted">
                Source balance after saving:{" "}
                <span className="font-mono tabular-nums">
                  {formatMoney(remaining, currencyCode)}
                </span>
              </p>
            )}
            {fromSphereId && Number(remaining) < 0 && (
              <p className="text-warning mt-1" data-testid="reallocation-warning">
                Insufficient sphere money. You can continue; the source sphere will have a negative
                balance.
              </p>
            )}
          </div>
        </form>
        {reallocationError && (
          <p role="alert" className="text-danger mt-2 text-sm" data-testid="reallocation-error">
            {reallocationError}
          </p>
        )}
        <h4 className="text-text mt-6 font-semibold">Reallocation history</h4>
        {reallocations.length === 0 && (
          <p className="text-text-muted mt-2 text-sm">No reallocations yet.</p>
        )}
        <ul className="mt-2">
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
                <div className="min-w-0">
                  <p className="text-text wrap-anywhere">
                    {fromSphere?.name ?? "Loading sphere…"} → {toSphere?.name ?? "Loading sphere…"}
                  </p>
                  <p
                    className="text-text mt-1 font-mono tabular-nums"
                    data-testid="reallocation-value"
                  >
                    {formatMoney(to.amount, to.currencyCode)}
                  </p>
                  <p className="text-text-muted mt-1 text-xs">{from.createdAt.toLocaleString()}</p>
                  {!editable && complete && (
                    <p className="text-text-muted mt-1 text-sm">
                      Restore archived spheres before editing or deleting this reallocation.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={pending || !context || !editable}
                    data-testid="reallocation-edit"
                    onClick={() => {
                      setEditingId(from.reallocationId!);
                      setFromSphereId(from.sphereId);
                      setToSphereId(to.sphereId);
                      setCurrencyCode(to.currencyCode);
                      setAmount(to.amount);
                      setDeletingId(null);
                      setReallocationError(null);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    disabled={pending || !context || !editable}
                    data-testid="reallocation-delete"
                    onClick={() => setDeletingId(from.reallocationId!)}
                  >
                    Delete
                  </Button>
                </div>
                {deletingId === from.reallocationId && (
                  <div
                    className="flex w-full flex-wrap items-center gap-2"
                    data-testid="reallocation-delete-confirmation"
                  >
                    <p className="text-text text-sm">
                      Delete this reallocation and reverse both sides?
                    </p>
                    <Button
                      variant="danger"
                      disabled={pending || !context || !editable}
                      data-testid="reallocation-delete-confirm"
                      onClick={() =>
                        context &&
                        runReallocation(() => deleteReallocation(from.reallocationId!, context))
                      }
                    >
                      Delete reallocation
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => setDeletingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </section>
  );
}
