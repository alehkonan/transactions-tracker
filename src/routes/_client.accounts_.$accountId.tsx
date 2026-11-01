import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AccountDetailScreen } from "~/screens/AccountDetailScreen";

export const Route = createFileRoute("/_client/accounts_/$accountId")({
  validateSearch: z.object({
    status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).optional().catch(undefined),
  }),
  component: AccountDetailRoute,
});

function AccountDetailRoute() {
  const { accountId } = Route.useParams();
  const { status } = Route.useSearch();
  return <AccountDetailScreen accountId={accountId} listStatus={status} />;
}
