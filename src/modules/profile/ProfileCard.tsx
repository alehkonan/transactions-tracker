import { FolderOpenIcon, PencilIcon, TrashIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "~/components/Button";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { Dialog } from "~/components/Dialog";
import { deleteProfile } from "~/modules/profile/profile-mutations";
import { ProfileForm } from "~/modules/profile/ProfileForm";
import { formatMoney } from "~/utils/format-money";
import type { ProfileSummary } from "~/modules/accounts/compute-balances";

type Props = {
  profile: ProfileSummary;
  onOpen: () => void;
};

/** A profile summary with explicit open, edit, and delete actions in its footer. */
export function ProfileCard({ profile, onOpen }: Props) {
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  const handleDelete = () => {
    startDeleteTransition(async () => {
      await deleteProfile(profile.id);
      setDeleteOpen(false);
    });
  };

  return (
    <div className="bg-surface border-border flex flex-col rounded-xl border">
      <div className="flex flex-col gap-3 p-4">
        <span className="text-text text-xl font-semibold">{profile.name}</span>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Current balance</span>
            <span className="font-mono">{formatMoney(profile.currentBalanceUsd, "USD")}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Savings balance</span>
            <span className="font-mono">{formatMoney(profile.savingsBalanceUsd, "USD")}</span>
          </div>
        </div>
        <span className="text-text-muted text-xs">
          {profile.accountCount} account{profile.accountCount === 1 ? "" : "s"} ·{" "}
          {profile.transactionCount} transaction{profile.transactionCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="border-border flex flex-wrap gap-2 border-t p-3">
        <Button variant="primary" onClick={onOpen}>
          <FolderOpenIcon className="size-4" />
          Open
        </Button>
        <Dialog
          title="Edit profile"
          renderTrigger={({ onOpen: openEdit }) => (
            <Button
              variant="secondary"
              aria-label={`Edit profile ${profile.name}`}
              onClick={openEdit}
            >
              <PencilIcon className="size-4" />
              Edit
            </Button>
          )}
        >
          <ProfileForm profile={profile} />
        </Dialog>
        <Button variant="danger" disabled={isDeleting} onClick={() => setDeleteOpen(true)}>
          <TrashIcon className="size-4" />
          Delete
        </Button>
      </div>
      <ConfirmDialog
        open={isDeleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove profile"
        message={`Delete profile "${profile.name}"? This also deletes all of its accounts, categories, and transactions.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDelete}
      />
    </div>
  );
}
