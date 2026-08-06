import { LandmarkIcon, PiggyBankIcon } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { accountTypeEnum } from "~/database/enums";
import type { LucideIcon } from "lucide-react";

type AccountType = (typeof accountTypeEnum.enumValues)[number];

type Props = {
  type: AccountType;
};

export const accountTypeStyles: Record<AccountType, string> = {
  CURRENT: "bg-accent/10 text-accent border-accent/20 dark:bg-accent/20 dark:border-accent/40",
  SAVING:
    "bg-orange-500/10 text-orange-600 border-orange-500/20 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/40",
};

export const accountTypeIcons: Record<AccountType, LucideIcon> = {
  CURRENT: LandmarkIcon,
  SAVING: PiggyBankIcon,
};

export function AccountTypeTag({ type }: Props) {
  const Icon = accountTypeIcons[type];
  return (
    <span
      className={twMerge(
        "inline-flex w-24 items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-center text-xs font-medium whitespace-nowrap capitalize",
        accountTypeStyles[type],
      )}
    >
      <Icon className="size-3" />
      {type.toLowerCase()}
    </span>
  );
}
