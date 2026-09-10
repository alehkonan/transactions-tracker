import { Button } from "~/components/Button";
import { PasskeyList } from "~/modules/auth/PasskeyList";
import { PasswordSettings } from "~/modules/auth/PasswordSettings";
import { useSecuritySettings } from "~/modules/auth/useSecuritySettings";

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

  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="max-w-xl">
          <h3 className="text-text font-bold">Sign-in methods</h3>
          <p className="text-text-muted text-sm">
            Credential details come directly from the server and are never stored on this device.
          </p>
        </div>
        {credentials && (
          <Button
            variant="secondary"
            disabled={isLoading || isMutating}
            onClick={() => void refresh()}
          >
            Refresh security details
          </Button>
        )}
      </div>

      {!isOnline ? (
        <div className="border-border bg-surface-muted mt-4 rounded-xl border p-3">
          <p className="text-text font-bold">Connect to manage account security</p>
          <p className="text-text-muted mt-1 text-sm">
            The rest of settings remains available offline. Security details require a connection so
            they always reflect the account’s current credentials.
          </p>
        </div>
      ) : isLoading && !credentials ? (
        <output className="text-text-muted mt-4 block text-sm">Loading security details…</output>
      ) : !credentials ? (
        <div className="mt-4" role="alert">
          <p className="text-danger text-sm">{error ?? "Could not load security details."}</p>
          <Button variant="secondary" className="mt-2" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {error && (
            <p className="text-danger text-sm" role="alert">
              {error}
            </p>
          )}
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div>
                <p className="text-text font-bold">Passkeys</p>
                <p className="text-text-muted text-sm">
                  Use a device or security key to sign in.
                  {credentials.passkeys.length > 0 &&
                    ` ${credentials.passkeys.length.toLocaleString()} ${credentials.passkeys.length === 1 ? "passkey" : "passkeys"} attached.`}
                </p>
              </div>
              <Button variant="secondary" disabled={isMutating} onClick={() => void addPasskey()}>
                {isMutating ? "Working…" : "Add passkey"}
              </Button>
            </div>
            <PasskeyList
              passkeys={credentials.passkeys}
              disabled={isMutating}
              onRemove={(passkey) => void deletePasskey(passkey.id)}
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
    </div>
  );
}
