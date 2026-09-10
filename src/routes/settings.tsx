import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { SecuritySection } from "~/modules/auth/SecuritySection";
import { readSessionHint } from "~/modules/auth/session-hint";
import { SignOutButton } from "~/modules/auth/SignOutButton";
import { CategoryTag } from "~/modules/categories/CategoryTag";
import { CreateCategoryButton } from "~/modules/categories/CreateCategoryButton";
import { useCategories } from "~/modules/categories/useCategories";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { IntegrityCheck } from "~/modules/sync/IntegrityCheck";
import { StoragePersistence } from "~/modules/sync/StoragePersistence";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { ExportTransactionsButton } from "~/modules/transactions/ExportTransactionsButton";

export const Route = createFileRoute("/settings")({
  component: () => {
    const categories = useCategories();
    const colors = useSyncStore((state) => state.colors);
    const profiles = useSyncStore((state) => state.profiles);
    const profileId = readSelectedProfileId();
    const profile = profiles.find((candidate) => candidate.id === profileId);
    // From the hint cookie rather than a `getSession()` call: the name is only being displayed, and
    // this page has no business being the one thing in the app that needs the network.
    const username = readSessionHint()?.username;

    return (
      <PageContainer>
        <main aria-labelledby="settings-heading" className="mx-auto max-w-4xl py-2 sm:py-6">
          <header className="mb-8">
            <h1 id="settings-heading" className="sr-only">
              Settings
            </h1>
            <p className="text-text-muted max-w-2xl">
              Manage your account, active profile, and the financial data stored on this device.
            </p>
          </header>

          <div className="space-y-8">
            <section aria-labelledby="account-access-title">
              <div className="mb-3">
                <div id="account-access-title">
                  <Title variant="card">Account & access</Title>
                </div>
                <p className="text-text-muted mt-1 text-sm">
                  Your identity and the methods you use to sign in.
                </p>
              </div>

              <div className="border-border bg-surface divide-border divide-y overflow-hidden rounded-xl border shadow-sm">
                <div className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <h3 className="text-text font-bold">Username</h3>
                    <p className="text-text-muted text-sm">The account currently signed in.</p>
                  </div>
                  <span className="text-text max-w-[50%] min-w-0 text-right font-medium break-words">
                    {username ?? "Signed in"}
                  </span>
                </div>

                <SecuritySection />

                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="max-w-xl">
                    <h3 className="text-text font-bold">Sign out on this device</h3>
                    <p className="text-text-muted text-sm">
                      Signing out removes this account’s local data from this browser. Synced data
                      downloads again after your next sign-in.
                    </p>
                  </div>
                  <SignOutButton />
                </div>
              </div>
            </section>

            <section aria-labelledby="current-profile-title">
              <div className="mb-3">
                <div id="current-profile-title">
                  <Title variant="card">Current profile</Title>
                </div>
                <p className="text-text-muted mt-1 text-sm">
                  The financial workspace used by accounts, categories, and transactions.
                </p>
              </div>

              <div className="border-border bg-surface divide-border divide-y overflow-hidden rounded-xl border shadow-sm">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div>
                    <h3 className="text-text font-bold">Active profile</h3>
                    <p className="text-text-muted text-sm">
                      {profile
                        ? "All figures on this device use this profile."
                        : "No profile selected."}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <span className="text-text font-medium">{profile?.name ?? "None"}</span>
                    <Link
                      to="/profile"
                      className="text-accent hover:text-accent-hover focus-visible:ring-accent inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-9"
                    >
                      Choose profile
                      <ChevronRightIcon className="size-4" aria-hidden="true" />
                    </Link>
                  </div>
                </div>

                <div className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div>
                      <h3 className="text-text font-bold">Categories</h3>
                      <p className="text-text-muted text-sm">
                        {categories.length === 0
                          ? "Organize transactions by purpose."
                          : `${categories.length.toLocaleString()} ${categories.length === 1 ? "category" : "categories"}. Select one to edit it.`}
                      </p>
                    </div>
                    <CreateCategoryButton colors={colors} />
                  </div>

                  {categories.length === 0 ? (
                    <p className="text-text-muted mt-4 text-sm">
                      No categories yet. Add one to make transaction history easier to understand.
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {categories.map((category) => (
                        <CategoryTag key={category.id} category={category} colors={colors} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section aria-labelledby="device-data-title">
              <div className="mb-3">
                <div id="device-data-title">
                  <Title variant="card">Data & this device</Title>
                </div>
                <p className="text-text-muted mt-1 text-sm">
                  Move transaction data and check the health of this browser’s local copy.
                </p>
              </div>

              <div className="border-border bg-surface divide-border divide-y overflow-hidden rounded-xl border shadow-sm">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <div className="max-w-xl">
                    <h3 className="text-text font-bold">Transaction data</h3>
                    <p className="text-text-muted text-sm">
                      Import a CSV into this profile or download its transactions for safekeeping.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/transactions-import"
                      className="text-accent hover:text-accent-hover focus-visible:ring-accent inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-9"
                    >
                      Import transactions
                      <ChevronRightIcon className="size-4" aria-hidden="true" />
                    </Link>
                    <ExportTransactionsButton />
                  </div>
                </div>

                <StoragePersistence />
                <IntegrityCheck />
              </div>
            </section>
          </div>
        </main>
      </PageContainer>
    );
  },
});
