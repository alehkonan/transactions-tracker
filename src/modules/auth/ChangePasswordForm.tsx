import { useForm } from "react-hook-form";
import { changePassword } from "~/api/auth.functions";
import { Button } from "~/components/Button";
import { InputControl } from "~/components/InputControl";
import { runAuthenticatedRequest } from "~/modules/auth/complete-sign-in";
import { getSecurityErrorMessage, unwrapServerResponse } from "~/modules/auth/security-errors";
import { useFormTask } from "~/modules/forms/form-task";

type Values = { currentPassword: string; newPassword: string; confirmPassword: string };

type Props = { onSaved: () => Promise<void> };

export function ChangePasswordForm({ onSaved }: Props) {
  const {
    control,
    getValues,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const { onCancel, onComplete } = useFormTask({ isDirty, isPending: isSubmitting });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await unwrapServerResponse(
        await runAuthenticatedRequest(() =>
          changePassword({ data: { currentPassword, newPassword } }),
        ),
      );
      await onSaved();
      onComplete();
    } catch (caught) {
      setError("root", { message: getSecurityErrorMessage(caught) ?? "Password was not changed." });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3">
      <InputControl
        control={control}
        name="currentPassword"
        type="password"
        label="Current password"
        autoComplete="current-password"
        rules={{ required: "Enter your current password." }}
      />
      <InputControl
        control={control}
        name="newPassword"
        type="password"
        label="New password"
        autoComplete="new-password"
        description="Use 12–128 characters."
        rules={{
          required: "Enter a new password.",
          validate: (value) =>
            (Array.from(value).length >= 12 && Array.from(value).length <= 128) ||
            "Password must be 12–128 characters.",
        }}
      />
      <InputControl
        control={control}
        name="confirmPassword"
        type="password"
        label="Confirm password"
        autoComplete="new-password"
        rules={{
          required: "Confirm the new password.",
          validate: (value) => value === getValues("newPassword") || "Passwords do not match.",
        }}
      />
      {errors.root?.message && <p className="text-danger text-sm">{errors.root.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
