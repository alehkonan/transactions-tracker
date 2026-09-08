import { PasskeyItem } from "~/modules/auth/PasskeyItem";

type Passkey = {
  id: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
};

type Props = {
  passkeys: Passkey[];
  disabled: boolean;
  onRemove: (passkey: Passkey) => void;
};

export function PasskeyList({ passkeys, disabled, onRemove }: Props) {
  if (passkeys.length === 0) {
    return (
      <p className="text-text-muted py-2 text-sm">No passkeys are attached to this account.</p>
    );
  }

  return (
    <ul>
      {passkeys.map((passkey) => (
        <PasskeyItem key={passkey.id} passkey={passkey} disabled={disabled} onRemove={onRemove} />
      ))}
    </ul>
  );
}
