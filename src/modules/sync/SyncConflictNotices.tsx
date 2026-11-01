import { Button } from "~/components/Button";
import { clearConflicts, useSyncStore } from "./useSyncStore";
import type { PushConflict } from "./sync-types";

function acknowledge(conflict: PushConflict, button: HTMLButtonElement) {
  const buttons = [...(button.closest("details")?.querySelectorAll("button") ?? [])];
  const index = buttons.indexOf(button);
  const next =
    buttons[index + 1] ?? buttons[index - 1] ?? document.getElementById("sync-status-region");
  next?.focus();
  clearConflicts([conflict]);
}

/** Keeps acceptance outcomes and their original profile context available until acknowledged. */
export function SyncConflictNotices() {
  const conflicts = useSyncStore((state) => state.conflicts);
  if (conflicts.length === 0) return null;

  const profiles = new Map<string, { name: string; conflicts: PushConflict[] }>();
  for (const conflict of conflicts) {
    const context = conflict.presentationContext;
    const key = JSON.stringify([context.profileId, context.profileName]);
    const group = profiles.get(key) ?? {
      name: context.profileName ?? "Profile unavailable",
      conflicts: [],
    };
    group.conflicts.push(conflict);
    profiles.set(key, group);
  }

  return (
    <div className="max-w-page mx-auto w-full shrink-0 px-4 pt-4">
      <details data-testid="sync-conflicts" className="bg-surface rounded-lg">
        <summary className="text-danger focus-visible:ring-accent min-h-11 cursor-pointer rounded-lg p-4 font-medium focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset">
          <output>
            {conflicts.length.toLocaleString()} sync {conflicts.length === 1 ? "notice" : "notices"}{" "}
            to review
          </output>
        </summary>
        <div className="border-border space-y-4 border-t p-4">
          <p className="text-text-muted text-sm">
            These changes met a newer server version. Review what was kept before editing again.
            Acknowledging a notice does not change the record.
          </p>
          {[...profiles.entries()].map(([profileId, profile]) => (
            <section key={profileId} aria-label={profile.name}>
              <h2 className="mb-2 font-semibold wrap-anywhere">{profile.name}</h2>
              <ul className="divide-border divide-y">
                {profile.conflicts.map((conflict) => (
                  <li
                    key={conflict.mutationId}
                    className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <h3 className="font-medium wrap-anywhere">
                        {conflict.presentationContext.entityLabel}
                      </h3>
                      <p className="text-danger mt-1 text-sm">
                        {conflict.classification === "intent-applied"
                          ? "Overwrote a newer change. Your version was kept."
                          : "Your change was not applied. The server state was kept."}
                      </p>
                      {conflict.classification !== "intent-applied" &&
                        conflict.table === "accounts" && (
                          <p className="text-text-muted mt-1 text-sm">
                            An account's currency is fixed. Use another account for a different
                            currency.
                          </p>
                        )}
                    </div>
                    <Button
                      variant="secondary"
                      className="self-start"
                      data-testid={`acknowledge-conflict-${conflict.mutationId}`}
                      onClick={(event) => acknowledge(conflict, event.currentTarget)}
                    >
                      Acknowledge
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}
