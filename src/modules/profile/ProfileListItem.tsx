import { CheckIcon, FolderOpenIcon, PencilIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { Popover } from "~/components/Popover";
import { PopoverConfirm } from "~/components/PopoverConfirm";
import { deleteProfile } from "~/modules/profile/profile-mutations";
import { ProfileForm } from "~/modules/profile/ProfileForm";
import { useReplicaBinding } from "~/modules/sync/useReplicaBinding";
import { formatMoney } from "~/utils/format-money";
import type { ProfileSummary } from "~/modules/accounts/compute-balances";

type Props = {
  profile: ProfileSummary;
  isSelected: boolean;
  disabled: boolean;
  onOpen: () => void;
};

/** One profile in the grouped list, with explicit selection and management actions. */
export function ProfileListItem({ profile, isSelected, disabled, onOpen }: Props) {
  const replicaContext = useReplicaBinding();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!replicaContext) return;
    setIsDeleting(true);
    try {
      await deleteProfile(profile.id, replicaContext);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 flex-col gap-2 p-4">
        <h2 className="text-lg font-semibold wrap-anywhere">{profile.name}</h2>
        {isSelected && (
          <p className="flex items-center gap-1 text-sm">
            <CheckIcon className="size-4 shrink-0" aria-hidden="true" />
            Current profile
          </p>
        )}
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <span className="text-text-muted">Approx. total balance</span>
            <span className="font-mono">≈ {formatMoney(profile.balanceUsd, "USD")}</span>
          </div>
        </div>
        <span className="text-text-muted text-xs">
          {profile.accountCount} account{profile.accountCount === 1 ? "" : "s"} ·{" "}
          {profile.transactionCount} transaction{profile.transactionCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        <Button
          variant="primary"
          disabled={disabled || isDeleting}
          onClick={onOpen}
          data-testid="profile-open"
        >
          <FolderOpenIcon className="size-4" aria-hidden="true" />
          Open
        </Button>
        <Dialog
          title="Edit profile"
          renderTrigger={({ onOpen: openEdit }) => (
            <Button
              variant="secondary"
              aria-label={`Edit profile ${profile.name}`}
              disabled={disabled || isDeleting}
              onClick={openEdit}
            >
              <PencilIcon className="size-4" aria-hidden="true" />
              Edit
            </Button>
          )}
        >
          <ProfileForm profile={profile} />
        </Dialog>
        <Popover
          sheet
          aria-label="Remove profile"
          renderTrigger={({ onOpen: openDelete }) => (
            <Button variant="danger" disabled={disabled || isDeleting} onClick={openDelete}>
              <TrashIcon className="size-4" aria-hidden="true" />
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
