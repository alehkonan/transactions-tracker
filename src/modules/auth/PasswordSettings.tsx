import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { AddPasswordForm } from "~/modules/auth/AddPasswordForm";
import { ChangePasswordForm } from "~/modules/auth/ChangePasswordForm";
import { RemovePasswordForm } from "~/modules/auth/RemovePasswordForm";

type Props = {
  hasPassword: boolean;
  disabled: boolean;
  onChanged: () => Promise<void>;
};

export function PasswordSettings({ hasPassword, disabled, onChanged }: Props) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-text font-bold">Password</p>
        <p className="text-text-muted text-sm">
          {hasPassword
            ? "A password can be used to sign in to this account."
            : "No password is attached to this account."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {hasPassword ? (
          <>
            <Dialog
              title="Change password"
              renderTrigger={({ onOpen }) => (
                <Button variant="secondary" disabled={disabled} onClick={onOpen}>
                  Change
                </Button>
              )}
            >
              <ChangePasswordForm onSaved={onChanged} />
            </Dialog>
            <Dialog
              title="Remove password"
              renderTrigger={({ onOpen }) => (
                <Button variant="danger" disabled={disabled} onClick={onOpen}>
                  Remove
                </Button>
              )}
            >
              <RemovePasswordForm onRemoved={onChanged} />
            </Dialog>
          </>
        ) : (
          <Dialog
            title="Add password"
            renderTrigger={({ onOpen }) => (
              <Button variant="secondary" disabled={disabled} onClick={onOpen}>
                Add password
              </Button>
            )}
          >
            <AddPasswordForm onSaved={onChanged} />
          </Dialog>
        )}
      </div>
    </div>
  );
}
