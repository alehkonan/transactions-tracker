import { LandmarkIcon, PiggyBankIcon } from "lucide-react";
import { accountTypeEnum } from "~/database/enums";
import type { LucideIcon } from "lucide-react";

type AccountType = (typeof accountTypeEnum.enumValues)[number];

export const accountTypeStyles: Record<AccountType, string> = {
  CURRENT: "bg-accent/10 text-accent border-accent/20",
  SAVING: "bg-hold/10 text-hold border-hold/20",
};

export const accountTypeIcons: Record<AccountType, LucideIcon> = {
  CURRENT: LandmarkIcon,
  SAVING: PiggyBankIcon,
};
