import { useContext } from "react";
import { useForm } from "react-hook-form";
import { removePassword } from "~/api/auth.functions";
import { Button } from "~/components/Button";
import { DialogContext } from "~/components/Dialog";
import { InputControl } from "~/components/InputControl";
import { getSecurityErrorMessage, unwrapServerResponse } from "~/modules/auth/security-errors";

type Values = { currentPassword: string };

type Props = { onRemoved: () => Promise<void> };

export function RemovePasswordForm({ onRemoved }: Props) {
  const { onClose } = useContext(DialogContext);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ defaultValues: { currentPassword: "" } });

  const onSubmit = handleSubmit(async ({ currentPassword }) => {
    try {
      await unwrapServerResponse(await removePassword({ data: { currentPassword } }));
      await onRemoved();
      onClose();
    } catch (caught) {
      setError("root", { message: getSecurityErrorMessage(caught) ?? "Password was not removed." });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3">
      <p className="text-text-muted text-sm">
        Enter your current password to confirm. You must keep at least one passkey on the account.
      </p>
      <InputControl
        control={control}
        name="currentPassword"
        type="password"
        label="Current password"
        autoComplete="current-password"
        rules={{ required: "Enter your current password." }}
      />
      {errors.root?.message && <p className="text-danger text-sm">{errors.root.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={isSubmitting} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Removing…" : "Remove password"}
        </Button>
      </div>
    </form>
  );
}
