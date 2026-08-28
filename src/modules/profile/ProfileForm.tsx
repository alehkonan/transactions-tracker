import { useContext } from "react";
import { useForm } from "react-hook-form";
import { Button } from "~/components/Button";
import { DialogContext } from "~/components/Dialog";
import { InputControl } from "~/components/InputControl";
import { createProfile, updateProfile } from "~/modules/profile/profile-mutations";
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
  const { onClose } = useContext(DialogContext);
  const isEditing = Boolean(profile);
  const { control, handleSubmit, reset, formState } = useForm<ProfileFormValues>({
    defaultValues: getDefaultValues(profile),
  });

  const onSubmit = handleSubmit(async ({ name }) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    if (profile) {
      await updateProfile(profile.id, trimmedName);
    } else {
      await createProfile(trimmedName);
      reset(getDefaultValues());
    }

    onClose();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-3">
      <InputControl
        control={control}
        name="name"
        label="Profile name"
        placeholder="Profile name"
        rules={{ validate: (value) => value.trim().length > 0 || "Profile name is required." }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={formState.isSubmitting}>
          {isEditing ? "Save" : "Create"}
        </Button>
      </div>
    </form>
  );
}
