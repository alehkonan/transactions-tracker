import { twMerge } from "tailwind-merge";
import { Chip } from "~/components/Chip";
import { accountStatusEnum } from "~/database/enums";

type AccountStatus = (typeof accountStatusEnum.enumValues)[number];

type Props = {
  status: AccountStatus;
};

const accountStatusStyles: Record<AccountStatus, string> = {
  ACTIVE: "bg-income/10 text-income border-income/20",
  ARCHIVED: "bg-text-muted/10 text-text-muted border-text-muted/20",
};

/** Status pill for an account, tinted green when active and gray once archived. */
export function AccountStatusChip({ status }: Props) {
  return (
    <Chip className={twMerge("text-xs font-medium capitalize", accountStatusStyles[status])}>
      {status.toLowerCase()}
    </Chip>
  );
}
