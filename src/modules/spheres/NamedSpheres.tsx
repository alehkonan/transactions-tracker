import { useId, useState, useTransition } from "react";
import { Button } from "~/components/Button";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import { sphereBalances, sphereHasHistory } from "./sphere-lifecycle";
import { createSphere, deleteSphere, updateSphere } from "./sphere-mutations";
import type { SyncedSphere } from "~/modules/sync/sync-types";

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
  const { spheres, selectedProfileId } = useSyncStore();
  const context = useReplicaBinding();
  const nameId = useId();
  const typeId = useId();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const owned = spheres.filter(
    (row) => row.profileId === selectedProfileId && row.deletedAt == null,
  );
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
    </section>
  );
}
