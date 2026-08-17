import { ArrowLeftRightIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { transactionTypeEnum } from "~/database/enums";
import type { LucideIcon } from "lucide-react";

type TransactionType = (typeof transactionTypeEnum.enumValues)[number];

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
