import { PlusIcon } from "lucide-react";
import { useContext, useState, useTransition } from "react";
import { Button } from "~/components/Button";
import { Dialog, DialogContext } from "~/components/Dialog";
import { createProfile } from "~/modules/profile/profile-mutations";
import type { FormEvent } from "react";

function CreateProfileForm() {
  const { onClose } = useContext(DialogContext);
  const [name, setName] = useState("");
  const [isCreating, startTransition] = useTransition();

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
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Profile name"
        className="border-border bg-surface text-text h-9 rounded-lg border px-2"
      />
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
        <Button variant="primary" onClick={onOpen}>
          <PlusIcon />
          <span className="hidden sm:block">New profile</span>
        </Button>
      )}
    >
      <CreateProfileForm />
    </Dialog>
  );
}
