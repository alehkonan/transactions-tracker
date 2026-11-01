import { createFileRoute } from "@tanstack/react-router";
import { TransactionDetailScreen } from "~/screens/TransactionDetailScreen";

export const Route = createFileRoute("/_client/transactions_/$transactionId")({
  component: TransactionDetailPage,
});

function TransactionDetailPage() {
  const { transactionId } = Route.useParams();
  return <TransactionDetailScreen transactionId={transactionId} />;
}
