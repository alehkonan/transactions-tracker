export const UI_PATHS = [
  "/",
  "/login",
  "/profile",
  "/accounts",
  "/transactions",
  "/statistics",
  "/settings",
  "/transactions-import",
] as const;

export type UiPath = (typeof UI_PATHS)[number];

export function isUiPath(pathname: string): boolean {
  if (pathname === "/") return true;
  const canonicalPath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (UI_PATHS as readonly string[]).includes(canonicalPath);
}

export function uiRewritePaths(): readonly string[] {
  return UI_PATHS.flatMap((path) => (path === "/" ? [path] : [path, `${path}/`]));
}
