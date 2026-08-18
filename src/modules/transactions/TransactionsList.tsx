import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { twJoin } from "tailwind-merge";
import { CategoryTag } from "~/modules/categories/CategoryTag";
import { ApproxUsdTag } from "~/modules/transactions/ApproxUsdTag";
import { DayHeader } from "~/modules/transactions/DayHeader";
import { transactionTypeIcons } from "~/modules/transactions/transaction-type-tag";
import { formatMoney } from "~/utils/format-money";
import type { CSSProperties, RefObject } from "react";
import type { TransactionRow } from "~/modules/transactions/to-transaction-rows";

type Props = {
  /** Days in display order, each with its own rows — see `groupTransactionsByDay`. */
  rowsByDay: Map<string, TransactionRow[]>;
  onRowClick?: (row: TransactionRow) => void;
};

/** Days and transactions in one flat sequence, which is what a virtualiser can count. */
type ListItem =
  | { kind: "header"; day: string; rows: TransactionRow[] }
  | { kind: "row"; row: TransactionRow; isFirstOfDay: boolean };

const HEADER_HEIGHT_ESTIMATE = 33;
const ROW_HEIGHT_ESTIMATE = 61;

/** Income reads green and a transfer reads as movement; an expense is the default and stays quiet. */
const amountToneStyles: Record<TransactionRow["type"], string> = {
  INCOME: "text-gain",
  EXPENSE: "text-text",
  TRANSFER: "text-transfer",
};

/** The second line: when it happened, how necessary it was, and whatever was typed about it. */
function detailLine(row: TransactionRow): string {
  const necessity = row.necessityLevel;
  return [
    format(row.createdAt, "HH:mm"),
    necessity && necessity.charAt(0) + necessity.slice(1).toLowerCase(),
    row.comment,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Never shrink below this, however little room a short viewport leaves. */
const MIN_HEIGHT = 240;

/**
 * How much room the page keeps below `element`: every ancestor's bottom padding, and anything
 * placed after it — here the page container's own padding and the `pb-24` the shell reserves for
 * the fixed navbar.
 *
 * Walked rather than read off `document.documentElement.scrollHeight`, which never reports less
 * than the viewport: once the list had shrunk, the slack under it counted as reserved space and it
 * could never grow back. `body` is excluded for the same reason — it carries `min-h-dvh`, so its
 * box is the viewport's, not the content's.
 */
function measureReservedBelow(element: HTMLElement): number {
  let reserved = 0;

  for (let node = element; node.parentElement && node.parentElement !== document.body;) {
    const parent = node.parentElement;
    reserved += parent.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom;
    node = parent;
  }

  return reserved;
}

function useAvailableHeight(ref: RefObject<HTMLElement | null>): number | undefined {
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      const available = window.innerHeight - top - measureReservedBelow(element);
      setHeight(Math.max(MIN_HEIGHT, available));
    };

    measure();
    // The body, because everything that can move this element's top is inside it — the filter row
    // wrapping, the sync strip changing height. Applying the measurement resizes the body in turn,
    // which re-runs this to the same answer and settles there.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);

  return height;
}

function toListItems(rowsByDay: Map<string, TransactionRow[]>): ListItem[] {
  const items: ListItem[] = [];
  for (const [day, rows] of rowsByDay) {
    items.push({ kind: "header", day, rows });
    rows.forEach((row, index) => items.push({ kind: "row", row, isFirstOfDay: index === 0 }));
  }
  return items;
}

/**
 * The phone presentation of the transactions table: one two-line row per transaction under a
 * sticky day header.
 *
 * The table it replaces below `sm` declares ~875px of columns and virtualises them sideways, so a
 * 390px screen shows the date and the category and nothing else — never the amount, which is half
 * of what anyone opens this screen to read. Same rows, same selection, different shape — and
 * virtualised the same way, since the row count is the same row count.
 */
export function TransactionsList({ rowsByDay, onRowClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const height = useAvailableHeight(containerRef);

  const items = useMemo(() => toListItems(rowsByDay), [rowsByDay]);
  const dayIndexes = useMemo(
    () => items.flatMap((item, index) => (item.kind === "header" ? [index] : [])),
    [items],
  );

  // Which day's header is currently pinned to the top of the scroller. A ref rather than state:
  // it is written during `rangeExtractor`, which runs inside the virtualiser's own measurement
  // pass, and setting state from there would re-render on every scroll frame.
  const stickyIndexRef = useRef(0);

  const rangeExtractor = useCallback(
    (range: { startIndex: number; endIndex: number; overscan: number; count: number }) => {
      stickyIndexRef.current = dayIndexes.findLast((index) => index <= range.startIndex) ?? 0;
      // The pinned header is kept in the rendered range even once its own rows have scrolled past,
      // because it is the only thing saying which day the rows under it belong to.
      return [...new Set([stickyIndexRef.current, ...defaultRangeExtractor(range)])].toSorted(
        (a, b) => a - b,
      );
    },
    [dayIndexes],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) =>
      items[index].kind === "header" ? HEADER_HEIGHT_ESTIMATE : ROW_HEIGHT_ESTIMATE,
    rangeExtractor,
    overscan: 8,
  });

  if (items.length === 0) {
    return (
      <div className="border-border bg-surface grid place-items-center rounded-xl border p-6">
        <p>No transactions in this range. Clear the filters or add one.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="border-border bg-surface isolate -mx-4 h-[75dvh] overflow-auto border-y"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          const isPinned = item.kind === "header" && stickyIndexRef.current === virtualItem.index;
          // The pinned header is the one element left in flow, at the top of the container, so
          // `sticky` has something to stick to; everything else is placed by transform.
          const style: CSSProperties = isPinned
            ? { position: "sticky", top: 0 }
            : { position: "absolute", top: 0, transform: `translateY(${virtualItem.start}px)` };

          if (item.kind === "header") {
            return (
              <div
                key={`header-${item.day}`}
                style={{ ...style, width: "100%" }}
                className={twJoin(
                  "bg-surface-muted border-border border-b px-3 py-1.5",
                  virtualItem.index > 0 && "border-t",
                  isPinned && "z-stack",
                )}
              >
                <DayHeader day={item.day} rows={item.rows} />
              </div>
            );
          }

          const row = item.row;
          const TypeIcon = transactionTypeIcons[row.type];

          return (
            <button
              key={row.id}
              style={{ ...style, width: "100%" }}
              type="button"
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={twJoin(
                "min-h-11 min-w-0 px-3 py-1",
                !item.isFirstOfDay && "border-border border-t",
              )}
            >
              <div className="text-text-muted flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate">{detailLine(row)}</span>
                {row.currencyCode !== "USD" && row.approxAmountUsd !== null && (
                  <ApproxUsdTag amountUsd={row.approxAmountUsd} />
                )}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <CategoryTag name={row.category} colorHex={row.categoryColorHex} />
                  <span className="text-text-muted truncate text-xs">{row.account}</span>
                </span>
                <span
                  className={twJoin(
                    "flex shrink-0 items-center gap-1 font-mono text-sm tabular-nums",
                    amountToneStyles[row.type],
                  )}
                >
                  {row.type === "TRANSFER" && <TypeIcon className="size-3" />}
                  {formatMoney(row.amount, row.currencyCode)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
