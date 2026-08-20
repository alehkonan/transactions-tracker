import { PlusIcon } from "lucide-react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { ProfileForm } from "~/modules/profile/ProfileForm";

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
      <ProfileForm />
    </Dialog>
  );
}
