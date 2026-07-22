import { createFileRoute } from "@tanstack/react-router";
import { Page } from "~/components/Page";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

function AboutPage() {
  return (
    <Page title="About">
      <p>About</p>
    </Page>
  );
}
