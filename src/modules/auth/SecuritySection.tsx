import { useState } from "react";
import { Button } from "~/components/Button";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { Title } from "~/components/Title";
import { PasskeyList } from "~/modules/auth/PasskeyList";
import { PasswordSettings } from "~/modules/auth/PasswordSettings";
import { useSecuritySettings } from "~/modules/auth/useSecuritySettings";

type SelectedPasskey = { id: string };

export function SecuritySection() {
  const {
    credentials,
    isOnline,
    isLoading,
    isMutating,
    error,
    refresh,
    addPasskey,
    deletePasskey,
  } = useSecuritySettings();
  const [selectedPasskey, setSelectedPasskey] = useState<SelectedPasskey | null>(null);

  return (
    <section aria-label="Security">
      <div className="flex items-center justify-between gap-2">
        <Title variant="section">Security</Title>
        {credentials && (
          <Button
            variant="secondary"
            disabled={isLoading || isMutating}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        )}
      </div>
      <p className="text-text-muted mt-1 text-sm">
        Credential details come directly from the server and are never stored on this device.
      </p>

      {!isOnline ? (
        <div className="border-border bg-surface-muted mt-3 rounded-xl border p-3">
          <p className="text-text font-bold">Connect to manage account security</p>
          <p className="text-text-muted mt-1 text-sm">
            The rest of settings remains available offline. Security details require a connection so
            they always reflect the account’s current credentials.
          </p>
        </div>
      ) : isLoading && !credentials ? (
        <output className="text-text-muted mt-3 block text-sm">Loading security details…</output>
      ) : !credentials ? (
        <div className="mt-3" role="alert">
          <p className="text-danger text-sm">{error ?? "Could not load security details."}</p>
          <Button variant="secondary" className="mt-2" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {error && (
            <p className="text-danger text-sm" role="alert">
              {error}
            </p>
          )}
          <div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-text font-bold">Passkeys</p>
                <p className="text-text-muted text-sm">Use a device or security key to sign in.</p>
              </div>
              <Button variant="primary" disabled={isMutating} onClick={() => void addPasskey()}>
                {isMutating ? "Working…" : "Add passkey"}
              </Button>
            </div>
            <PasskeyList
              passkeys={credentials.passkeys}
              disabled={isMutating}
              onRemove={setSelectedPasskey}
            />
          </div>
          <div className="border-border border-t pt-4">
            <PasswordSettings
              hasPassword={credentials.password != null}
              disabled={isMutating}
              onChanged={refresh}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={selectedPasskey != null}
        onOpenChange={(open) => {
          if (!open) setSelectedPasskey(null);
        }}
        title="Remove passkey"
        message="Remove this passkey from your account? You will no longer be able to use it to sign in."
        confirmLabel="Remove"
        confirmVariant="danger"
        onConfirm={() => {
          if (selectedPasskey) void deletePasskey(selectedPasskey.id);
          setSelectedPasskey(null);
        }}
      />
    </section>
  );
}
