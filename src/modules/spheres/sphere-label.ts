import type { SyncedSphere } from "~/modules/sync/sync-types";

export function sphereLabel(sphere: Pick<SyncedSphere, "type" | "name">): string {
  return sphere.type === "OPERATING"
    ? "Operating"
    : `${sphere.type === "FUNDS" ? "Funds" : "Capital"} / ${sphere.name}`;
}
