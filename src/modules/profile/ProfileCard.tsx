import { FolderOpenIcon, PencilIcon, TrashIcon } from "lucide-react";
import { useTransition } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import { deleteProfile } from "~/modules/profile/profile-mutations";
import { ProfileForm } from "~/modules/profile/ProfileForm";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { formatMoney } from "~/utils/format-money";
import type { ProfileSummary } from "~/modules/accounts/compute-balances";

type Props = {
  profile: ProfileSummary;
  onOpen: () => void;
};

/** A profile summary with explicit open, edit, and delete actions in its footer. */
export function ProfileCard({ profile, onOpen }: Props) {
  const replicaContext = useSyncStore((state) => state.replicaContext);
  const [isDeleting, startDeleteTransition] = useTransition();

  const handleDelete = () => {
    if (!replicaContext) return;
    startDeleteTransition(async () => {
      await deleteProfile(profile.id, replicaContext);
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
        <Popover
          aria-label="Remove profile"
          renderTrigger={({ onOpen: openDelete }) => (
            <Button variant="danger" disabled={isDeleting} onClick={openDelete}>
              <TrashIcon className="size-4" />
              Delete
            </Button>
          )}
        >
          <PopoverConfirm
            title="Remove profile"
            message={`Delete profile "${profile.name}"? This also deletes all of its accounts, categories, and transactions.`}
            confirmLabel="Delete"
            confirmVariant="danger"
            onConfirm={handleDelete}
          />
        </Popover>
      </div>
    </div>
  );
}
