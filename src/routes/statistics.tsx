import { createFileRoute } from "@tanstack/react-router";
import { PageContainer } from "~/components/PageContainer";

export const Route = createFileRoute("/statistics")({
  component: () => {
    return (
      <PageContainer>
        <p>TODO</p>
      </PageContainer>
    );
  },
});
