import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { twJoin } from "tailwind-merge";
import { Chip } from "~/components/Chip";
import { Title } from "~/components/Title";
import { AccountCard } from "~/modules/accounts/AccountCard";
import { formatMoney } from "~/utils/formatMoney";
import type { getAccounts } from "~/api/account.functions";

type Account = Awaited<ReturnType<typeof getAccounts>>[number];

type Props = {
  /** Stable key used to persist this group's collapsed state in localStorage. */
  id: string;
  title: string;
  accounts: Account[];
  totalUsd?: string;
  /** Tint classes for the total chip, matching this group's `AccountCard` color (see `accountTypeCardGradients`/`accountStatusStyles`). */
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

  useEffect(() => {
    const stored = readStoredCollapsed(id);
    if (stored !== undefined) setCollapsed(stored);
  }, [id]);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      writeStoredCollapsed(id, next);
      return next;
    });
  };

  /** While collapsed, clicking the front (only interactive) card of the peek stack expands the group instead of opening its edit dialog. */
  const expand = () => {
    setCollapsed(false);
    writeStoredCollapsed(id, false);
  };

  const peekCount = Math.min(PEEK_COUNT, accounts.length);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <Title variant="card">{title}</Title>
          {totalUsd !== undefined && (
            <Chip className={twJoin("font-mono font-medium", totalChipClassName)}>
              {formatMoney(totalUsd, "USD")}
            </Chip>
          )}
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="text-accent text-sm font-medium hover:underline"
        >
          {collapsed ? "Show more" : "Show less"}
        </button>
      </div>
      <hr className="border-border my-3" />
      {/*
       * `isolate` scopes the stack's z-indexes to a new stacking context, so the raw numbers
       * below can never compete with the global z-index scale (styles.css) — see the
       * z-index-system skill.
       */}
      <div
        className={twJoin(
          "isolate",
          collapsed
            ? "relative h-[calc(18rem*5/8+1.5rem)] w-72"
            : "grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2",
        )}
      >
        {accounts.map((account, index) => {
          const stackIndex = Math.min(index, peekCount);
          return (
            <motion.div
              key={account.id}
              layout
              transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              className={collapsed ? "absolute inset-0" : undefined}
              style={
                collapsed
                  ? {
                      zIndex: peekCount - stackIndex,
                      pointerEvents: index === 0 ? "auto" : "none",
                      transformOrigin: "50% 0%",
                    }
                  : undefined
              }
              animate={
                collapsed
                  ? {
                      y: stackIndex * 18,
                      scale: 1 - stackIndex * 0.05,
                      opacity: index < peekCount ? 1 - index * 0.25 : 0,
                    }
                  : { y: 0, scale: 1, opacity: 1 }
              }
              initial={false}
            >
              <AccountCard account={account} onClick={collapsed ? expand : undefined} />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
