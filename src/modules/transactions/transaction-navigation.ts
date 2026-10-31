/** Only an in-app list entry can supply a return destination; direct URLs use Transactions. */
export type TransactionListOrigin = {
  profileId: string;
  replicaId: string;
  historyIndex: number;
};

declare module "@tanstack/react-router" {
  interface HistoryState {
    transactionListOrigin?: TransactionListOrigin;
  }
}
