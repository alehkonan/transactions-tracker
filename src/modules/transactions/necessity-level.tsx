import { necessityLevelEnum } from "~/database/enums";

type NecessityLevel = (typeof necessityLevelEnum.enumValues)[number];

export const necessityLevelStyles: Record<NecessityLevel, string> = {
  LOW: "bg-necessity-low-muted text-necessity-low border-necessity-low-border",
  MEDIUM: "bg-necessity-medium-muted text-necessity-medium border-necessity-medium-border",
  HIGH: "bg-necessity-high-muted text-necessity-high border-necessity-high-border",
  ESSENTIAL:
    "bg-necessity-essential-muted text-necessity-essential border-necessity-essential-border",
};
