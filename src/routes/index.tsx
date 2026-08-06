import { Link, createFileRoute, useLoaderData } from "@tanstack/react-router";
import { getAccounts } from "~/api/account.functions";
import { getCategories } from "~/api/category.functions";
import { Card } from "~/components/Card";
import { PageContainer } from "~/components/PageContainer";
import { Title } from "~/components/Title";
import { DeleteAllCategoriesButton } from "~/modules/categories/DeleteAllCategoriesButton";
import { DeleteCategoryButton } from "~/modules/categories/DeleteCategoryButton";
import { formatMoney } from "~/utils/formatMoney";

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
    const activeCurrentAccounts = accounts.filter(
      (account) => account.status === "ACTIVE" && account.type === "CURRENT",
    );

    return (
      <PageContainer>
        <div className="grid gap-2 md:grid-cols-2">
          <Card>
            <div className="flex items-center justify-between">
              <Title variant="card">Active accounts</Title>
              <Link to="/accounts" className="text-accent text-sm font-medium hover:underline">
                Manage accounts
              </Link>
            </div>
            <hr className="border-border my-3" />
            {activeCurrentAccounts.length === 0 ? (
              <p>No active accounts.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {activeCurrentAccounts.map((account) => (
                  <li key={account.id} className="flex items-center justify-between gap-2 py-1">
                    {account.name}
                    <span className="font-mono font-medium">
                      {formatMoney(account.balance, account.currencyCode)}
                    </span>
                  </li>
                ))}
              </ul>
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
