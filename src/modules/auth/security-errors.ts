export async function unwrapServerResponse<T>(value: T): Promise<T> {
  if (!(value instanceof Response)) return value;

  const message = (await value.text()).trim();
  throw new Error(message || `Request failed (${value.status}).`);
}

export function getSecurityErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "AbortError") return null;
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
