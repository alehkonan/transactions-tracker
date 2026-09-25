/** Accept only same-origin UI paths, never schemes, protocol-relative URLs, or the login page itself. */
export function getSignInReturnPath(location: Location = window.location): string {
  const requested = new URLSearchParams(location.search).get("returnTo");
  if (!requested || !requested.startsWith("/") || requested.startsWith("//")) return "/";

  try {
    const destination = new URL(requested, location.origin);
    if (destination.origin !== location.origin || destination.pathname === "/login") return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}
