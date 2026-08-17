import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { twJoin } from "tailwind-merge";
import { Checkbox } from "~/components/Checkbox";
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
  onSelectionChange?: (selectedRows: TransactionRow[]) => void;
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
  INCOME: "text-income",
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

/**
 * The height that makes `ref` fill exactly what is left of the viewport, in pixels: everything
 * between what sits above it and what is reserved below it.
 *
 * Measured rather than written as a `dvh` fraction, and measured at both ends rather than against
 * a constant. Above it is a filter row that can wrap to another line; below it are the page's own
 * bottom padding and the `pb-24` the shell reserves for the fixed navbar. Nothing here has to know
 * those numbers — it reads the space that is actually there, so the navbar can move without this
 * going stale.
 *
 * Sizing it exactly is also what stops the page itself from scrolling: the list scrolls, and the
 * thumb has one scroll region to find instead of two.
 */
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
export function TransactionsList({ rowsByDay, onSelectionChange, onRowClick }: Props) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
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

  // A row that is no longer in the list cannot stay selected — the same reset the table does when
  // a filter changes the data under it.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [rowsByDay]);

  useEffect(() => {
    if (!onSelectionChange) return;
    onSelectionChange([...rowsByDay.values()].flat().filter((row) => selectedIds.has(row.id)));
  }, [selectedIds, rowsByDay, onSelectionChange]);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  if (items.length === 0) {
    return (
      <div className="border-border bg-surface grid place-items-center rounded-xl border p-6">
        <p>No data</p>
      </div>
    );
  }

  return (
    // Full-bleed: `-mx-4` cancels `PageContainer`'s padding, since 390px has no width to spare for
    // a gutter and a rounded card edge. Only the top and bottom borders survive — a box with no
    // sides is a section rather than a card that has outgrown its page.
    //
    // `isolate` keeps the pinned header's `z-stack` from competing with the global z-index scale.
    // The scroller is bounded so the virtualiser has a viewport to measure against; the page it
    // sits on is what the thumb reaches for anyway on a screen this size.
    <div
      ref={containerRef}
      // `75dvh` only until the first measurement lands, which is the same frame.
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
            <div
              key={row.id}
              style={{ ...style, width: "100%" }}
              className={twJoin(
                "flex items-center gap-1 pl-1",
                !item.isFirstOfDay && "border-border border-t",
              )}
            >
              <span className="grid size-11 shrink-0 place-items-center">
                {/* The box stays 24px and the target becomes 44: the pseudo-element belongs to
                    the checkbox, so it takes the taps the box is too small to catch. */}
                <Checkbox
                  aria-label="Select transaction"
                  className="relative before:absolute before:-inset-2.5"
                  checked={selectedIds.has(row.id)}
                  onCheckedChange={(checked) => toggleSelected(row.id, checked)}
                />
              </span>
              <button
                type="button"
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className="min-h-11 min-w-0 flex-1 py-2 pr-3 text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
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
                <div className="text-text-muted mt-0.5 flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate">{detailLine(row)}</span>
                  {row.currencyCode !== "USD" && row.approxAmountUsd != null && (
                    <ApproxUsdTag amountUsd={row.approxAmountUsd} />
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
