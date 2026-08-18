import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { getSignInOptions, getSignUpOptions, signIn, signUp } from "~/api/auth.functions";
import { resetLocalData } from "~/modules/sync/sync-engine";

/**
 * A cancelled ceremony is the user closing the OS passkey sheet — expected, not an error worth
 * showing. Anything else gets whatever message the server or the browser gave us.
 */
function toErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "AbortError") return null;
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Drives both passkey ceremonies against the auth server functions.
 *
 * On mount it also starts a conditional ("autofill") request when the browser supports one, so a
 * returning visitor who already has a passkey for this site is offered it by the browser and
 * signed in without pressing anything.
 */
export function usePasskeyAuth() {
  const navigate = useNavigate();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Assumed rather than probed, because `browserSupportsWebAuthn()` is always false during SSR
  // and correcting it mid-render would be a hydration mismatch. The effect below downgrades it.
  const [isSupported, setIsSupported] = useState(true);

  const onSignedIn = useCallback(async () => {
    // Whatever is in IndexedDB belongs to whoever was signed in before — possibly somebody else on a
    // shared browser. Dropping it means the app boots into a clean full pull for this account.
    await resetLocalData();
    await navigate({ to: "/", replace: true });
  }, [navigate]);

  const handleSignUp = useCallback(
    async (username: string) => {
      setError(null);
      setIsPending(true);
      try {
        // Cancel the conditional request first: only one ceremony can be in flight at a time.
        WebAuthnAbortService.cancelCeremony();
        const optionsJSON = await getSignUpOptions({ data: { username } });
        const response = await startRegistration({ optionsJSON });
        await signUp({ data: response });
        await onSignedIn();
      } catch (caught) {
        setError(toErrorMessage(caught));
      } finally {
        setIsPending(false);
      }
    },
    [onSignedIn],
  );

  const handleSignIn = useCallback(async () => {
    setError(null);
    setIsPending(true);
    try {
      WebAuthnAbortService.cancelCeremony();
      const optionsJSON = await getSignInOptions();
      const response = await startAuthentication({ optionsJSON });
      await signIn({ data: response });
      await onSignedIn();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setIsPending(false);
    }
  }, [onSignedIn]);

  useEffect(() => {
    let cancelled = false;

    const startAutofill = async () => {
      if (!browserSupportsWebAuthn()) {
        setIsSupported(false);
        return;
      }
      if (!(await browserSupportsWebAuthnAutofill())) return;

      try {
        const optionsJSON = await getSignInOptions();
        if (cancelled) return;

        const response = await startAuthentication({ optionsJSON, useBrowserAutofill: true });
        await signIn({ data: response });
        if (!cancelled) await onSignedIn();
      } catch {
        // The conditional request is a background convenience — if it is aborted (because the
        // user pressed a button instead) or fails, the explicit flows are still there.
      }
    };

    void startAutofill();

    return () => {
      cancelled = true;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [onSignedIn]);

  return { isSupported, isPending, error, handleSignUp, handleSignIn };
}
