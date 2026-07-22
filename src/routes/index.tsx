import { createFileRoute } from "@tanstack/react-router";
import { Page } from "~/components/Page";
import { getAccounts } from "~/lib/accounts";

export const Route = createFileRoute("/")({
  loader: () => getAccounts(),
  component: HomePage,
});

function HomePage() {
  const accounts = Route.useLoaderData();

  return (
    <Page title="Accounts">
      {accounts.length === 0 ? (
        <p>No accounts yet.</p>
      ) : (
        <ul>
          {accounts.map((account) => (
            <li key={account.id}>
              {account.name} — {account.balance} {account.currencyCode} ({account.status})
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
