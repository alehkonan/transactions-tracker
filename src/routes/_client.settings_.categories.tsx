import { createFileRoute } from "@tanstack/react-router";
import { CategoriesScreen } from "~/screens/CategoriesScreen";

export const Route = createFileRoute("/_client/settings_/categories")({
  component: CategoriesScreen,
});
