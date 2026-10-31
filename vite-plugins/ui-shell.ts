export const UI_PATHS = [
  "/",
  "/login",
  "/profile",
  "/accounts",
  "/transactions",
  "/transactions/new",
  "/transactions/:transactionId",
  "/statistics",
  "/settings",
  "/transactions-import",
] as const;

/** A named parameter admits exactly one nonempty path segment, never an arbitrary subtree. */
export function uiPathPatterns(paths: readonly string[] = UI_PATHS): string[] {
  return paths.map((path) => `^${path.replace(/:[^/]+/g, "[^/]+")}${path === "/" ? "" : "/?"}$`);
}

export function isUiPath(pathname: string, paths: readonly string[] = UI_PATHS): boolean {
  return uiPathPatterns(paths).some((pattern) => new RegExp(pattern).test(pathname));
}

export function uiRewritePaths(): readonly string[] {
  return UI_PATHS.flatMap((path) => (path === "/" ? [path] : [path, `${path}/`]));
}
