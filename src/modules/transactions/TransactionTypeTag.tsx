import { ArrowLeftRightIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { transactionTypeEnum } from "~/database/enums";
import type { LucideIcon } from "lucide-react";

type TransactionType = (typeof transactionTypeEnum.enumValues)[number];

type Props = {
  type: TransactionType;
};

export const transactionTypeStyles: Record<TransactionType, string> = {
  INCOME: "bg-income/10 text-income border-income/20 dark:bg-income/20 dark:border-income/40",
  EXPENSE: "bg-expense/10 text-expense border-expense/20 dark:bg-expense/20 dark:border-expense/40",
  TRANSFER:
    "bg-transfer/10 text-transfer border-transfer/20 dark:bg-transfer/20 dark:border-transfer/40",
};

export const transactionTypeIcons: Record<TransactionType, LucideIcon> = {
  INCOME: TrendingUpIcon,
  EXPENSE: TrendingDownIcon,
  TRANSFER: ArrowLeftRightIcon,
};

export function TransactionTypeTag({ type }: Props) {
  const Icon = transactionTypeIcons[type];
  return (
    <span
      className={twMerge(
        "inline-flex w-20 items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-center text-xs font-medium whitespace-nowrap capitalize",
        transactionTypeStyles[type],
      )}
    >
      <Icon className="size-3" />
      {type.toLowerCase()}
    </span>
  );
}
