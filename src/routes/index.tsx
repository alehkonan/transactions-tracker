import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { getAccounts } from "~/api/account.functions";
import { getCategories } from "~/api/category.functions";
import { Card } from "~/components/Card";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { AccountCard } from "~/modules/accounts/AccountCard";
import { DeleteAllAccountsButton } from "~/modules/accounts/DeleteAllAccountsButton";
import { ReconcileBalancesButton } from "~/modules/accounts/ReconcileBalancesButton";
import { DeleteAllCategoriesButton } from "~/modules/categories/DeleteAllCategoriesButton";
import { DeleteCategoryButton } from "~/modules/categories/DeleteCategoryButton";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);

    return {
      accounts,
      categories,
    };
  },
  component: () => {
    const { accounts, categories } = useLoaderData({ from: "/" });

    return (
      <PageContainer>
        <div className="grid gap-2 md:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between">
              <Title variant="card">Active accounts</Title>
              <div className="flex items-center gap-2">
                <ReconcileBalancesButton />
                <DeleteAllAccountsButton disabled={accounts.length === 0} />
              </div>
            </div>
            <hr className="border-border my-3" />
            {accounts.length === 0 ? (
              <p>No accounts yet.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2">
                {accounts.map((account) => (
                  <AccountCard key={account.id} account={account} />
                ))}
              </div>
            )}
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <Title variant="card">Categories</Title>
              <DeleteAllCategoriesButton disabled={categories.length === 0} />
            </div>
            <hr className="border-border my-3" />
            {categories.length === 0 ? (
              <p>No categories yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {categories.map((category) => (
                  <li key={category.id} className="flex items-center justify-between gap-2 py-1">
                    <span className="flex items-center gap-2">
                      <span
                        className="border-border size-3 shrink-0 rounded-full border"
                        style={{ backgroundColor: category.colorHex ?? undefined }}
                      />
                      {category.name}
                    </span>
                    <DeleteCategoryButton id={category.id} name={category.name} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PageContainer>
    );
  },
});
