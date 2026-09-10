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
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        {hasPassword ? (
          <>
            <Dialog
              title="Change password"
              renderTrigger={({ onOpen }) => (
                <Button
                  variant="secondary"
                  className="flex-1 sm:flex-none"
                  disabled={disabled}
                  onClick={onOpen}
                >
                  Change password
                </Button>
              )}
            >
              <ChangePasswordForm onSaved={onChanged} />
            </Dialog>
            <Dialog
              title="Remove password"
              renderTrigger={({ onOpen }) => (
                <Button
                  variant="danger"
                  className="flex-1 sm:flex-none"
                  disabled={disabled}
                  onClick={onOpen}
                >
                  Remove password
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
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={disabled}
                onClick={onOpen}
              >
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
