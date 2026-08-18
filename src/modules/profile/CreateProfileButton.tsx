import { Field } from "@base-ui/react/field";
import { PlusIcon } from "lucide-react";
import { useContext, useId, useState, useTransition } from "react";
import { Button } from "~/components/Button";
import { Dialog, DialogContext } from "~/components/Dialog";
import { createProfile } from "~/modules/profile/profile-mutations";
import type { FormEvent } from "react";

function CreateProfileForm() {
  const { onClose } = useContext(DialogContext);
  const [name, setName] = useState("");
  const [isCreating, startTransition] = useTransition();
  const inputId = useId();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    startTransition(async () => {
      // Awaited all the way to the server: the next thing the user does is pick this profile, and
      // that mints a signed cookie the server will only issue for a profile it can see.
      await createProfile(name.trim());
      onClose();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-3">
      <Field.Root className="flex flex-col gap-1">
        <Field.Label htmlFor={inputId} className="text-text text-sm font-bold">
          Profile name
        </Field.Label>
        <input
          id={inputId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Profile name"
          className="border-border bg-surface text-text h-11 rounded-lg border px-2 sm:h-9"
        />
      </Field.Root>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!name.trim() || isCreating}>
          Create
        </Button>
      </div>
    </form>
  );
}

export function CreateProfileButton() {
  return (
    <Dialog
      title="Create profile"
      renderTrigger={({ onOpen }) => (
        <Button variant="primary" aria-label="New profile" onClick={onOpen}>
          <PlusIcon />
          <span className="hidden sm:block">New profile</span>
        </Button>
      )}
    >
      <CreateProfileForm />
    </Dialog>
  );
}
