import { useForm } from "react-hook-form";
import { addPassword } from "~/api/auth.functions";
import { Button } from "~/components/Button";
import { InputControl } from "~/components/InputControl";
import { runAuthenticatedRequest } from "~/modules/auth/complete-sign-in";
import { getSecurityErrorMessage, unwrapServerResponse } from "~/modules/auth/security-errors";
import { useFormTask } from "~/modules/forms/form-task";

type Values = { newPassword: string; confirmPassword: string };

type Props = { onSaved: () => Promise<void> };

export function AddPasswordForm({ onSaved }: Props) {
  const {
    control,
    getValues,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ defaultValues: { newPassword: "", confirmPassword: "" } });

  const { onCancel, onComplete } = useFormTask({ isDirty, isPending: isSubmitting });

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    try {
      await unwrapServerResponse(
        await runAuthenticatedRequest(() => addPassword({ data: { password: newPassword } })),
      );
      await onSaved();
      onComplete();
    } catch (caught) {
      setError("root", { message: getSecurityErrorMessage(caught) ?? "Password was not added." });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3">
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
          {isSubmitting ? "Adding…" : "Add password"}
        </Button>
      </div>
    </form>
  );
}
