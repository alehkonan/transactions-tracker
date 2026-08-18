import { necessityLevelEnum } from "~/database/enums";

type NecessityLevel = (typeof necessityLevelEnum.enumValues)[number];

export const necessityLevelStyles: Record<NecessityLevel, string> = {
  LOW: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40",
  MEDIUM:
    "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-500/20 dark:text-yellow-300 dark:border-yellow-500/40",
  HIGH: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/40",
  ESSENTIAL:
    "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/40",
};
