import { Link, useNavigate, useSearch, useRouter } from "@tanstack/react-router";
import { parseISO } from "date-fns";
import { ListFilterIcon, PlusIcon, XIcon } from "lucide-react";
import { useDeferredValue, useEffect, useMemo } from "react";
import { Button } from "~/components/Button";
import { Dialog } from "~/components/Dialog";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { useAccounts } from "~/modules/accounts/useAccounts";
import { useCategories } from "~/modules/categories/useCategories";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { filterTransactions } from "~/modules/transactions/filter-transactions";
import { groupTransactionsByDay } from "~/modules/transactions/group-transactions-by-day";
import { TransactionsAccountFilter } from "~/modules/transactions/TransactionsAccountFilter";
import { TransactionsCategoryFilter } from "~/modules/transactions/TransactionsCategoryFilter";
import {
  formatDateFilterLabel,
  TransactionsDateRangeFilter,
} from "~/modules/transactions/TransactionsDateRangeFilter";
import { TransactionsEmptyState } from "~/modules/transactions/TransactionsEmptyState";
import { TransactionsList } from "~/modules/transactions/TransactionsList";
import { TransactionsSearchInput } from "~/modules/transactions/TransactionsSearchInput";
import { useTransactionRows } from "~/modules/transactions/useTransactionRows";
import type { TransactionListOrigin } from "~/modules/transactions/transaction-navigation";

export function TransactionsScreen() {
  const {
    from,
    to,
    account: accountFilter,
    accountId,
    category: categoryFilter,
    q,
  } = useSearch({ from: "/_client/transactions" });
  const navigate = useNavigate({ from: "/transactions" });
  const router = useRouter();
  const accounts = useAccounts();
  const linkedAccount = accounts.find((account) => account.id === accountId);
  const categories = useCategories();
  const allTransactions = useTransactionRows();
  const activeAccounts = accounts.filter((account) => account.status === "ACTIVE");
  const search = q ?? "";
  const setSearch = (value: string) => {
    void navigate({
      search: (previous) => ({ ...previous, q: value || undefined }),
      replace: true,
      resetScroll: false,
    });
  };
  const deferredSearch = useDeferredValue(search);
  const openTransaction = (transactionId?: string) => {
    const { selectedProfileId, replicaContext } = useSyncStore.getState();
    if (!selectedProfileId || !replicaContext) return;
    const state = {
      transactionListOrigin: {
        profileId: selectedProfileId,
        replicaId: replicaContext.replicaId,
        // oxlint-disable-next-line eslint/no-underscore-dangle -- TanStack Router's history state key.
        historyIndex: router.state.location.state.__TSR_index,
      } satisfies TransactionListOrigin,
    };
    if (transactionId)
      void navigate({ to: "/transactions/$transactionId", params: { transactionId }, state });
    else void navigate({ to: "/transactions/new", state });
  };

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;
      event.preventDefault();
      document.querySelector<HTMLInputElement>("#transaction-search")?.focus();
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  // Filtering stays local and deferred: typing remains immediate even when the complete replica is large.
  const transactions = useMemo(
    () =>
      filterTransactions(allTransactions, {
        from,
        to,
        account: accountFilter,
        accountId,
        category: categoryFilter,
        search: deferredSearch,
      }),
    [allTransactions, from, to, accountFilter, accountId, categoryFilter, deferredSearch],
  );

  const transactionsByDay = useMemo(() => groupTransactionsByDay(transactions), [transactions]);
  const isSearching = search !== deferredSearch;
  const activeFilterCount = [from || to, accountId || accountFilter, categoryFilter].filter(
    Boolean,
  ).length;
  const hasFilters = activeFilterCount > 0;

  const clearFilters = () =>
    navigate({
      search: (previous) => ({
        ...previous,
        from: undefined,
        to: undefined,
        account: undefined,
        accountId: undefined,
        category: undefined,
      }),
    });

  const activeFilters = [
    from || to
      ? {
          key: "date",
          label: formatDateFilterLabel({
            from: from ? parseISO(from) : undefined,
            to: to ? parseISO(to) : undefined,
          }),
          onClear: () =>
            navigate({
              search: (previous) => ({ ...previous, from: undefined, to: undefined }),
            }),
        }
      : null,
    accountId || accountFilter
      ? {
          key: "account",
          label: accountId
            ? (linkedAccount?.name ?? "Unavailable account")
            : (accountFilter ?? "Account"),
          onClear: () =>
            navigate({
              search: (previous) => ({ ...previous, account: undefined, accountId: undefined }),
            }),
        }
      : null,
    categoryFilter
      ? {
          key: "category",
          label: categoryFilter,
          onClear: () => navigate({ search: (previous) => ({ ...previous, category: undefined }) }),
        }
      : null,
  ].filter((filter): filter is NonNullable<typeof filter> => filter !== null);

  const transactionCountLabel = isSearching
    ? "Searching…"
    : transactions.length === allTransactions.length
      ? `${allTransactions.length.toLocaleString()} ${allTransactions.length === 1 ? "transaction" : "transactions"}`
      : `${transactions.length.toLocaleString()} of ${allTransactions.length.toLocaleString()} transactions`;

  const emptyState =
    activeAccounts.length === 0 && allTransactions.length === 0 ? (
      <TransactionsEmptyState kind="no-accounts" />
    ) : allTransactions.length === 0 ? (
      <TransactionsEmptyState kind="no-transactions" onAddTransaction={() => openTransaction()} />
    ) : search.trim() ? (
      <TransactionsEmptyState kind="search" query={search} onClearSearch={() => setSearch("")} />
    ) : (
      <TransactionsEmptyState kind="filters" onClearFilters={() => void clearFilters()} />
    );

  return (
    <PageContainer className="flex min-h-0 w-full flex-1">
      <main
        aria-label="Transactions"
        className="mx-auto grid min-h-0 w-full max-w-4xl flex-1 grid-rows-[auto_auto_minmax(0,1fr)] gap-4 py-2 md:py-6"
      >
        <div>
          {linkedAccount ? (
            <PageHeader
              title="Transactions"
              backLabel={linkedAccount.name}
              onBack={() =>
                void navigate({
                  to: "/accounts/$accountId",
                  params: { accountId: linkedAccount.id },
                  search: { status: linkedAccount.status },
                })
              }
            />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          )}
          <p aria-live="polite" className="text-text-muted text-sm">
            {transactionCountLabel}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <TransactionsSearchInput value={search} onValueChange={setSearch} />
          <div className="flex shrink-0 gap-2">
            <Dialog
              title="Filters"
              closeButtonLabel="Close filters"
              renderTrigger={({ onOpen }) => (
                <Button
                  variant="secondary"
                  data-testid="transaction-filters"
                  aria-label={
                    hasFilters
                      ? `Transaction filters, ${activeFilterCount} active`
                      : "Transaction filters"
                  }
                  className="size-11 p-0 md:h-9 md:w-auto md:px-3"
                  onClick={onOpen}
                >
                  <ListFilterIcon className="size-4" />
                  <span className="hidden md:block">Filters</span>
                  {hasFilters && (
                    <span
                      aria-hidden="true"
                      className="bg-accent text-surface grid min-w-5 place-items-center rounded-lg px-1 text-xs font-bold"
                    >
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              )}
            >
              <p className="text-text-muted mt-1 pr-10 text-sm">
                Changes apply immediately. Close when the ledger shows what you need.
              </p>
              <div className="mt-4 flex flex-wrap items-start gap-3">
                <TransactionsDateRangeFilter from={from} to={to} />
                <TransactionsAccountFilter
                  accounts={accounts}
                  selected={accountFilter}
                  selectedId={accountId}
                />
                <TransactionsCategoryFilter categories={categories} selected={categoryFilter} />
              </div>
            </Dialog>

            <Button
              variant="primary"
              aria-label="Add transaction"
              data-testid="transaction-create"
              className="size-11 p-0 md:h-9 md:w-auto md:px-3"
              onClick={() => openTransaction()}
              disabled={activeAccounts.length === 0}
              title={activeAccounts.length === 0 ? "Create an active account first" : undefined}
            >
              <PlusIcon className="size-4" />
              <span className="hidden md:block">Add transaction</span>
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          {activeAccounts.length === 0 && allTransactions.length > 0 && (
            <p className="text-text-muted text-sm">
              To add a transaction, create or reactivate an account in{" "}
              <Link className="text-accent underline" to="/accounts">
                Money
              </Link>
              .
            </p>
          )}
          {activeFilters.length > 0 && (
            <div
              aria-label="Active transaction filters"
              className="flex flex-wrap items-center gap-2"
            >
              {activeFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => void filter.onClear()}
                  aria-label={`Remove ${filter.label} filter`}
                  className="border-border bg-surface-muted text-text hover:bg-surface-active focus-visible:ring-accent inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none md:min-h-8"
                >
                  <span className="max-w-56 truncate">{filter.label}</span>
                  <XIcon className="size-3.5 shrink-0" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => void clearFilters()}
                className="text-text-muted hover:text-text focus-visible:ring-accent min-h-11 rounded-lg px-2 text-sm underline decoration-current underline-offset-4 focus-visible:ring-2 focus-visible:outline-none md:min-h-8"
              >
                Clear all
              </button>
            </div>
          )}

          {transactions.length > 0 ? (
            <TransactionsList
              rowsByDay={transactionsByDay}
              onRowClick={(row) => openTransaction(row.id)}
            />
          ) : (
            emptyState
          )}
        </div>
      </main>
    </PageContainer>
  );
}
