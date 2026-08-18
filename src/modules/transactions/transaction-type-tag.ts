import { ArrowLeftRightIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { transactionTypeEnum } from "~/database/enums";
import type { LucideIcon } from "lucide-react";

type TransactionType = (typeof transactionTypeEnum.enumValues)[number];

export const transactionTypeStyles: Record<TransactionType, string> = {
  INCOME: "bg-gain/10 text-gain border-gain/20",
  EXPENSE: "bg-spend/10 text-spend border-spend/20",
  TRANSFER: "bg-graphite/10 text-graphite border-graphite/20",
};

export const transactionTypeIcons: Record<TransactionType, LucideIcon> = {
  INCOME: TrendingUpIcon,
  EXPENSE: TrendingDownIcon,
  TRANSFER: ArrowLeftRightIcon,
};
