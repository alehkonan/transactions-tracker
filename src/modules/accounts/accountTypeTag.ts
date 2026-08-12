import { LandmarkIcon, PiggyBankIcon } from "lucide-react";
import { accountTypeEnum } from "~/database/enums";
import type { LucideIcon } from "lucide-react";

type AccountType = (typeof accountTypeEnum.enumValues)[number];

export const accountTypeStyles: Record<AccountType, string> = {
  CURRENT: "bg-accent/10 text-accent border-accent/20 dark:bg-accent/20 dark:border-accent/40",
  SAVING:
    "bg-orange-500/10 text-orange-600 border-orange-500/20 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/40",
};

export const accountTypeIcons: Record<AccountType, LucideIcon> = {
  CURRENT: LandmarkIcon,
  SAVING: PiggyBankIcon,
};
