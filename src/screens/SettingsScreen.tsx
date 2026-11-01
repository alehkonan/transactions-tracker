import { PageContainer } from "~/components/PageContainer";
import { SettingsGroup, SettingsLink } from "~/components/SettingsGroup";
import { SignOutButton } from "~/modules/auth/SignOutButton";
import { useCategories } from "~/modules/categories/useCategories";
import { useSelectedProfileId } from "~/modules/profile/local-selection";
import { IntegrityCheck } from "~/modules/sync/IntegrityCheck";
import { StoragePersistence } from "~/modules/sync/StoragePersistence";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { ExportTransactionsButton } from "~/modules/transactions/ExportTransactionsButton";

export function SettingsScreen() {
  const categories = useCategories();
  const profiles = useSyncStore((state) => state.profiles);
  const profileId = useSelectedProfileId();
  const profile = profiles.find((candidate) => candidate.id === profileId);
  const username = useSyncStore((state) => state.replicaUsername);

  return (
    <PageContainer className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <main aria-labelledby="settings-heading" className="mx-auto">
        <h1 id="settings-heading" className="mb-6 text-2xl font-bold tracking-tight">
          Settings
        </h1>
        <div className="space-y-6">
          <SettingsGroup title="Identity & access">
            <div className="p-4">
              <h3 className="font-medium">Username</h3>
              <p className="text-text-muted mt-0.5 text-sm wrap-anywhere">
                {username ?? "Local replica owner"}
              </p>
            </div>
            <SettingsLink
              to="/settings/security"
              label="Sign-in methods"
              description="Manage passkeys and your password."
            />
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-text-muted max-w-lg text-sm">
                Signing out removes this account’s local data from this browser. Synced data
                downloads again after your next sign-in.
              </p>
              <SignOutButton />
            </div>
          </SettingsGroup>

          <SettingsGroup title="Current profile">
            <SettingsLink
              to="/profile"
              label="Choose profile"
              description={profile?.name ?? "No profile selected"}
              data-testid="settings-profile"
            />
            <SettingsLink
              to="/settings/categories"
              label="Categories"
              description={
                categories.length === 0
                  ? "Add categories to organize your transactions."
                  : `${categories.length.toLocaleString()} ${categories.length === 1 ? "category" : "categories"}`
              }
            />
          </SettingsGroup>

          <SettingsGroup title="Data & this device">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="font-medium">Export transactions</h3>
                <p className="text-text-muted mt-0.5 text-sm">
                  Download this profile’s transactions as CSV, even offline.
                </p>
              </div>
              <ExportTransactionsButton />
            </div>
            <StoragePersistence />
            <IntegrityCheck />
          </SettingsGroup>
        </div>
      </main>
    </PageContainer>
  );
}
