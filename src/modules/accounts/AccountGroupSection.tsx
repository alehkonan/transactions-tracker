import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { twJoin } from "tailwind-merge";
import { Chip } from "~/components/Chip";
import { AccountCard } from "~/modules/accounts/AccountCard";
import { formatMoney } from "~/utils/format-money";
import type { AccountActivity } from "~/modules/accounts/compute-account-activity";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

gsap.registerPlugin(useGSAP, Flip);

type Props = {
  /** Stable key used to persist this group's collapsed state in localStorage. */
  id: string;
  title: string;
  accounts: AccountWithBalance[];
  /** Last movement and month-to-date per account id — see `computeAccountActivity`. */
  activityByAccount: Map<string, AccountActivity>;
  totalUsd?: string;
  /** Tint classes for the total chip, matching this group's `AccountCard` color (see `accountTypeStyles`/`accountStatusStyles` in `accountTypeTag`/`AccountStatusChip`). */
  totalChipClassName?: string;
  /** Collapsed state to render before the stored preference (if any) is read on mount. */
  defaultCollapsed?: boolean;
};

/** How many cards peek out of the collapsed stack. */
const PEEK_COUNT = 3;

const STORAGE_KEY = "accounts:collapsedGroups";

function readStoredCollapsed(id: string): boolean | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>;
    return stored[id];
  } catch {
    return undefined;
  }
}

function writeStoredCollapsed(id: string, collapsed: boolean) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>;
    stored[id] = collapsed;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // localStorage unavailable (private mode, disabled) — collapsed state just won't persist.
  }
}

/** One titled, divided section of `AccountCard`s on the accounts page, collapsible to a peek stack. */
export function AccountGroupSection({
  id,
  title,
  accounts,
  activityByAccount,
  totalUsd,
  totalChipClassName,
  defaultCollapsed,
}: Props) {
  const [collapsed, setCollapsed] = useState(Boolean(defaultCollapsed));
  const gridRef = useRef<HTMLDivElement>(null);
  // Captured by `Flip.getState()` right before a toggle (in the click handlers, before React
  // re-renders) so `useGSAP` below can animate from that pre-toggle layout to the new one. Left
  // `null` for the localStorage-restoration effect, which should snap instantly, not animate.
  const flipStateRef = useRef<Flip.FlipState | null>(null);

  useEffect(() => {
    const stored = readStoredCollapsed(id);
    if (stored !== undefined) setCollapsed(stored);
  }, [id]);

  const captureFlipState = () => {
    if (gridRef.current) flipStateRef.current = Flip.getState(gridRef.current.children);
  };

  const toggleCollapsed = () => {
    captureFlipState();
    setCollapsed((value) => {
      const next = !value;
      writeStoredCollapsed(id, next);
      return next;
    });
  };

  /** While collapsed, clicking the front (only interactive) card of the peek stack expands the group instead of opening its edit dialog. */
  const expand = () => {
    captureFlipState();
    setCollapsed(false);
    writeStoredCollapsed(id, false);
  };

  // Animates from the layout captured just before `collapsed` changed to the new one GSAP's Flip
  // plugin (First-Last-Invert-Play): it diffs each card's actual before/after bounding box —
  // covering both the grid-position change (auto-flowed vs all sharing cell 1/1) and the peek
  // stack's resting `transform` (offset/scale) below — and animates the difference in one go.
  // No `absolute: true`: that option pulls cards out of grid flow for the duration of the
  // animation, which collapses this group's row height mid-transition and made the section below
  // jump up over it — unnecessary anyway since every card stays within the same grid the whole time.
  useGSAP(
    () => {
      if (!flipStateRef.current) return;
      Flip.from(flipStateRef.current, { duration: 0.5, ease: "power3.out" });
      flipStateRef.current = null;
    },
    { dependencies: [collapsed], scope: gridRef },
  );

  const peekCount = Math.min(PEEK_COUNT, accounts.length);
  const headingId = `${id}-accounts-heading`;
  const panelId = `${id}-accounts-list`;
  const hasConvertedCurrencies = accounts.some((account) => account.currencyCode !== "USD");

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls={panelId}
          className={twJoin(
            "mb-3 flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left",
            "hover:bg-surface-muted focus-visible:ring-accent transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          )}
        >
          <span className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-text text-xl font-semibold">{title}</span>
            {totalUsd !== undefined && (
              <span className="flex items-center gap-2">
                <span className="text-text-muted text-xs font-medium">USD equivalent</span>
                <Chip className={twJoin("font-mono font-medium", totalChipClassName)}>
                  {hasConvertedCurrencies && "≈ "}
                  {formatMoney(totalUsd, "USD")}
                </Chip>
              </span>
            )}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={twJoin(
              "text-text-muted size-4 shrink-0 transition-transform",
              !collapsed && "rotate-180",
            )}
          />
        </button>
      </h2>
      {/*
       * `isolate` scopes the stack's z-indexes to a new stacking context, so the raw numbers
       * below can never compete with the global z-index scale (styles.css) — see the
       * z-index-system skill.
       *
       * The collapsed peek stack reuses this same grid instead of a separately-sized box: every
       * stacked card is placed in grid cell 1/1 (CSS Grid natively allows overlapping items), so
       * its size is always exactly a real grid cell's — not a guessed pixel size that can drift
       * from the actual card width once columns stretch via `1fr`.
       */}
      <div
        id={panelId}
        ref={gridRef}
        className="isolate grid grid-cols-[repeat(auto-fill,minmax(min(18rem,100%),1fr))] gap-2"
      >
        {accounts.map((account, index) => {
          const stackIndex = Math.min(index, peekCount - 1);
          const isPeeking = index < peekCount;
          return (
            <div
              key={account.id}
              // Cards beyond the visible peek are hidden entirely, not just faded out.
              className={collapsed && !isPeeking ? "invisible" : undefined}
              style={{
                // Kept identical across both states (not just while collapsed) so the expand/collapse
                // transition never hands stacking order to DOM order mid-animation: without an explicit
                // zIndex here, cards further back in the stack would flash in front of the ones nearer
                // the top the instant `collapsed` flips, making later cards look like they're peeled off
                // the top instead of unstacked from the bottom.
                zIndex: accounts.length - index,
                gridColumn: collapsed ? 1 : undefined,
                gridRow: collapsed ? 1 : undefined,
                pointerEvents: collapsed && index !== 0 ? "none" : undefined,
                transformOrigin: "0% 50%",
                // This is the card's resting position/scale (not a GSAP-driven animation) — Flip
                // above animates the visual transition into it by diffing actual before/after
                // bounding boxes, so this only needs to describe where each card ends up.
                transform: collapsed
                  ? `translateX(${stackIndex * 18}px) scale(${1 - stackIndex * 0.05})`
                  : undefined,
              }}
            >
              <AccountCard
                account={account}
                activity={activityByAccount.get(account.id)}
                onClick={collapsed ? expand : undefined}
                actionLabel={collapsed ? `Expand ${title} accounts` : undefined}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
