import type { PasswordAuthMode } from "./usePasswordAuthForm";

const DATABASE_SETUP_MESSAGE =
  "Account creation is temporarily unavailable because the server database needs an update. Please contact the administrator.";

const SAFE_SIGN_UP_MESSAGES = new Set([
  "That username is already taken.",
  "Password must be 12-128 characters.",
]);

/** Converts authentication failures into messages that are safe to render outside server logs. */
export function getPasswordAuthErrorMessage(mode: PasswordAuthMode, error: unknown): string {
  if (mode === "sign-in") {
    return "Unable to sign in. Check your credentials and try again.";
  }

  const message = error instanceof Error ? error.message : "";
  if (SAFE_SIGN_UP_MESSAGES.has(message)) return message;
  if (/failed query:.*password_credentials/is.test(message)) return DATABASE_SETUP_MESSAGE;
  if (/too many authentication attempts/i.test(message)) {
    return "Too many attempts. Please wait and try again.";
  }

  return "Unable to create your account right now. Please try again later.";
}
