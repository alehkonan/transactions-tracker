import { accountTypeEnum } from "~/database/enums";

type AccountType = (typeof accountTypeEnum.enumValues)[number];

export const accountTypeStyles: Record<AccountType, string> = {
  CURRENT: "bg-accent/10 text-accent border-accent/20",
  SAVING: "bg-hold/10 text-hold border-hold/20",
};
