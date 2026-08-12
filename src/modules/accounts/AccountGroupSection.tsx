import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { twJoin } from "tailwind-merge";
import { Chip } from "~/components/Chip";
import { Title } from "~/components/Title";
import { AccountCard } from "~/modules/accounts/AccountCard";
import { formatMoney } from "~/utils/format-money";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";

gsap.registerPlugin(useGSAP, Flip);

type Props = {
  /** Stable key used to persist this group's collapsed state in localStorage. */
  id: string;
  title: string;
  accounts: AccountWithBalance[];
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

  return (
    <div>
      <button
        type="button"
        onClick={toggleCollapsed}
        className={twJoin(
          "mb-2 flex items-center gap-2 rounded-lg p-3",
          "hover:bg-surface-muted transition-colors",
        )}
      >
        <div className="flex items-baseline gap-2">
          <Title variant="card">{title}</Title>
          {totalUsd !== undefined && (
            <Chip className={twJoin("font-mono font-medium", totalChipClassName)}>
              {formatMoney(totalUsd, "USD")}
            </Chip>
          )}
        </div>
        <ChevronRightIcon
          className={twJoin(
            "text-text-muted size-4 shrink-0 transition-transform",
            !collapsed && "rotate-180",
          )}
        />
      </button>
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
        ref={gridRef}
        className="isolate grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2"
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
              <AccountCard account={account} onClick={collapsed ? expand : undefined} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
