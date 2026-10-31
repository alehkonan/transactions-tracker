import { createFileRoute } from "@tanstack/react-router";
import { SphereDetailScreen } from "~/screens/SphereDetailScreen";

export const Route = createFileRoute("/_client/accounts_/purposes/$sphereId")({
  component: SphereDetailRoute,
});

function SphereDetailRoute() {
  const { sphereId } = Route.useParams();
  return <SphereDetailScreen sphereId={sphereId} />;
}
