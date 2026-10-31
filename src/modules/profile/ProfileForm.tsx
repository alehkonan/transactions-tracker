import { useForm } from "react-hook-form";
import { Button } from "~/components/Button";
import { InputControl } from "~/components/InputControl";
import { useFormTask } from "~/modules/forms/form-task";
import { createProfile, updateProfile } from "~/modules/profile/profile-mutations";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import type { ProfileSummary } from "~/modules/accounts/compute-balances";

type ProfileFormValues = {
  name: string;
};

type Props = {
  /** When set, the form edits this existing profile instead of creating one. */
  profile?: Pick<ProfileSummary, "id" | "name">;
};

function getDefaultValues(profile?: Props["profile"]): ProfileFormValues {
  return { name: profile?.name ?? "" };
}

/** Creates or renames a profile. */
export function ProfileForm({ profile }: Props) {
  const replicaContext = useReplicaBinding();
  const isEditing = Boolean(profile);
  const { control, handleSubmit, reset, setError, formState } = useForm<ProfileFormValues>({
    defaultValues: getDefaultValues(profile),
  });

  const { onCancel, onComplete } = useFormTask({
    isDirty: formState.isDirty,
    isPending: formState.isSubmitting,
  });

  const onSubmit = handleSubmit(async ({ name }) => {
    try {
      const trimmedName = name.trim();
      if (!trimmedName) return;
      if (!replicaContext)
        throw new Error("Your local data is unavailable. Reopen the form and try again.");

      if (profile) {
        await updateProfile(profile.id, trimmedName, replicaContext);
      } else {
        await createProfile(trimmedName, replicaContext);
        reset(getDefaultValues());
      }

      onComplete();
    } catch (cause) {
      setError("root", {
        message: cause instanceof Error ? cause.message : "Could not save your changes. Try again.",
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3">
      {formState.errors.root?.message && (
        <p role="alert" className="text-danger text-sm">
          {formState.errors.root.message}
        </p>
      )}
      <InputControl
        control={control}
        name="name"
        label="Profile name"
        placeholder="Profile name"
        autoCapitalize="words"
        enterKeyHint="done"
        rules={{ validate: (value) => value.trim().length > 0 || "Profile name is required." }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={formState.isSubmitting}>
          {isEditing ? "Save" : "Create"}
        </Button>
      </div>
    </form>
  );
}
