import { Button } from "~/components/Button";

type Passkey = {
  id: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
};

type Props = {
  passkey: Passkey;
  disabled: boolean;
  onRemove: (passkey: Passkey) => void;
};

function formatDate(value: Date | string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function PasskeyItem({ passkey, disabled, onRemove }: Props) {
  return (
    <li className="border-border flex flex-col gap-3 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-text-muted">Created</dt>
          <dd className="text-text mt-0.5">{formatDate(passkey.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Last used</dt>
          <dd className="text-text mt-0.5">{formatDate(passkey.lastUsedAt)}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Device type</dt>
          <dd className="text-text mt-0.5 capitalize">{passkey.deviceType}</dd>
        </div>
        <div>
          <dt className="text-text-muted">Backup</dt>
          <dd className="text-text mt-0.5">{passkey.backedUp ? "Backed up" : "Not backed up"}</dd>
        </div>
      </dl>
      <Button variant="danger" disabled={disabled} onClick={() => onRemove(passkey)}>
        Remove
      </Button>
    </li>
  );
}
