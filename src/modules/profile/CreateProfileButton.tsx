import { PlusIcon } from "lucide-react";
import { useContext, useState, useTransition } from "react";
import { createProfile } from "~/api/profile.functions";
import { Button } from "~/components/Button";
import { Dialog, DialogContext } from "~/components/Dialog";
import { syncNow } from "~/modules/sync/useSyncStore";
import type { FormEvent } from "react";

function CreateProfileForm() {
  const { onClose } = useContext(DialogContext);
  const [name, setName] = useState("");
  const [isCreating, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    startTransition(async () => {
      await createProfile({ data: { name: name.trim() } });
      await syncNow();
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
